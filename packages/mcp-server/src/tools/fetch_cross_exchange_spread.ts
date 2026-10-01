import { createHmac } from 'node:crypto';
import {
  FetchCrossExchangeSpreadInputSchema,
  type FetchCrossExchangeSpreadInput,
} from '../schemas/index.js';

export const ELDORADO_SUPPORTED_FIATS = ['USD', 'ARS', 'BRL', 'COP', 'PEN'] as const;

interface LiveRates {
  buyRate: number;
  sellRate: number;
}

interface VenueQuote extends LiveRates {
  exchange: string;
  source: 'LIVE';
}

const BINANCE_P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';

/**
 * Where each venue's number would come from. Declared so that a missing reading
 * names its origin instead of silently defaulting to a price.
 */
const EXPECTED_SOURCES = {
  binance: 'Binance P2P C2C público (p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search)',
  bybit: 'Bybit P2P (BYBIT_API_KEY + BYBIT_API_SECRET)',
  eldorado: 'El Dorado (ELDORADO_CLIENT_ID + ELDORADO_REFERRAL_ID)',
};

/**
 * Binance C2C public search payload. No credentials required.
 */
function buildBinanceSearchPayload(
  asset: string,
  fiat: string,
  tradeType: 'BUY' | 'SELL',
): Record<string, unknown> {
  return {
    asset,
    fiat,
    tradeType,
    page: 1,
    rows: 20,
    payTypes: [],
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    filterType: 'all',
    periods: [],
  };
}

/**
 * Best prices out of a raw Binance C2C response.
 *
 * Binance semantics: `tradeType BUY` ads are makers *selling* crypto, so they
 * are our asks and the cheapest of them is what we would pay. `tradeType SELL`
 * ads are makers *buying* crypto, so they are our bids and the dearest of them
 * is what we would receive.
 */
function bestBinanceRates(data: unknown): LiveRates | null {
  const items = Array.isArray(data)
    ? data
    : ((data as { data?: unknown[] } | null)?.data ?? null);
  if (!Array.isArray(items)) return null;

  const prices = items
    .map((item) => Number((item as { adv?: { price?: string | number } })?.adv?.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return null;

  // Mixed batch: take the two extremes. The caller splits BUY/SELL, so within a
  // single response every quote is on one side of the book.
  return { buyRate: Math.min(...prices), sellRate: Math.max(...prices) };
}

/**
 * Reads Binance P2P from the public C2C endpoint. No credentials required, which
 * is why the previous hardcoded `baseRate: 79.2` had no excuse: a real reading
 * was available and was not taken.
 *
 * Exported so the parallel-rates feed reads the same venue through the same code
 * instead of growing a second, differently-shaped Binance client.
 *
 * Orientation: `buyRate` is the cheapest maker *selling*, which is what we would
 * pay to acquire — our ask. `sellRate` is the dearest maker *buying*, which is
 * what we would receive — our bid.
 */
export async function fetchBinanceLiveRates(asset: string, fiat: string): Promise<LiveRates | null> {
  const ask = async (tradeType: 'BUY' | 'SELL'): Promise<LiveRates | null> => {
    try {
      const res = await fetch(BINANCE_P2P_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildBinanceSearchPayload(asset, fiat, tradeType)),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { code?: string; data?: unknown };
      // Binance answers 200 with an application-level error code.
      if (json.code && json.code !== '000000') return null;
      return bestBinanceRates(json.data);
    } catch {
      return null;
    }
  };

  const [asks, bids] = await Promise.all([ask('BUY'), ask('SELL')]);
  if (!asks || !bids) return null;
  if (asks.buyRate <= 0 || bids.sellRate <= 0) return null;
  return { buyRate: asks.buyRate, sellRate: bids.sellRate };
}

/**
 * Tries to fetch live Bybit P2P top-of-book. Requires BYBIT_API_KEY and
 * BYBIT_API_SECRET env vars; returns null (simulated fallback) otherwise.
 */
async function fetchBybitLiveRates(asset: string, fiat: string): Promise<LiveRates | null> {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const commit = async (side: 0 | 1): Promise<number[]> => {
      const body = JSON.stringify({ tokenId: asset, currencyId: fiat, side, page: 1, size: 10 });
      const timestamp = Date.now().toString();
      const recvWindow = '20000';
      const sign = createHmac('sha256', apiSecret)
        .update(`${timestamp}${apiKey}${recvWindow}${body}`)
        .digest('hex');

      const res = await fetch('https://api.bybit.com/v5/p2p/item/online', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'X-BAPI-SIGN': sign,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        result?: {
          items?: { price?: string | number }[];
          list?: { price?: string | number }[];
        };
      };
      const items = json.result?.items ?? json.result?.list ?? [];
      return items.map((it) => Number(it.price)).filter((p) => Number.isFinite(p) && p > 0);
    };

    // side 1 = SELL ads (asks), side 0 = BUY ads (bids).
    const asks = await commit(1);
    const bids = await commit(0);
    if (asks.length === 0 || bids.length === 0) return null;

    const buyRate = Math.min(...asks);
    const sellRate = Math.max(...bids);
    if (buyRate <= 0 || sellRate <= 0 || sellRate <= buyRate) return null;
    return { buyRate, sellRate };
  } catch {
    return null;
  }
}

/**
 * Tries to fetch live El Dorado quotes. Requires ELDORADO_CLIENT_ID and
 * ELDORADO_REFERRAL_ID (optional ELDORADO_API_KEY); null when not configured
 * or when the fiat is not supported by El Dorado.
 */
async function fetchElDoradoLiveRates(asset: string, fiat: string): Promise<LiveRates | null> {
  const clientId = process.env.ELDORADO_CLIENT_ID;
  const referralId = process.env.ELDORADO_REFERRAL_ID;
  const apiKey = process.env.ELDORADO_API_KEY;
  if (!clientId || !referralId) return null;
  if (!(ELDORADO_SUPPORTED_FIATS as readonly string[]).includes(fiat)) return null;

  try {
    const commit = async (direction: 'buy' | 'sell'): Promise<number | null> => {
      const headers: Record<string, string> = {
        'X-Client-ID': clientId,
        'X-Referral-ID': referralId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(`https://api.eldorado.io/api/quote/${direction}`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers,
        body: JSON.stringify({ crypto: asset, legalTender: fiat }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, unknown>;
      const quote = (json.quote ?? json.data ?? json) as { rate?: number | string };
      const rate = Number(quote.rate);
      return Number.isFinite(rate) && rate > 0 ? rate : null;
    };

    const buyRate = await commit('buy');
    const sellRate = await commit('sell');
    if (buyRate == null || sellRate == null || sellRate <= buyRate) return null;
    return { buyRate, sellRate };
  } catch {
    return null;
  }
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function spreadPct(buyRate: number, sellRate: number): number {
  return Number((((sellRate - buyRate) / buyRate) * 100).toFixed(2));
}

export const fetchCrossExchangeSpreadTool = {
  name: 'fetch_cross_exchange_spread',
  description:
    'Compara libros P2P entre venues para detectar discrepancias de precios. Sólo devuelve veredicto de arbitraje cuando hay al menos dos cotizaciones reales; sin fuente en vivo declara la ausencia en vez de mostrar precios de ejemplo.',
  inputSchema: FetchCrossExchangeSpreadInputSchema,
  execute: async (input: FetchCrossExchangeSpreadInput) => {
    const fiat = input.fiat;
    const asset = input.asset;
    const payment = input.paymentMethod;
    const timestamp = new Date().toISOString();

    const [binanceLive, bybitLive, elDoradoLive] = await Promise.all([
      fetchBinanceLiveRates(asset, fiat),
      fetchBybitLiveRates(asset, fiat),
      fetchElDoradoLiveRates(asset, fiat),
    ]);

    /**
     * Only venues that were actually read appear here.
     *
     * The previous version synthesised Binance, OKX and KuCoin from a hardcoded
     * `baseRate` and then ranked those invented quotes together with the live
     * ones to produce `isViable`. The fabricated venues usually won, so the tool
     * returned a tradeability verdict for prices nobody quoted. A venue that was
     * not read is absent, not approximated.
     */
    const exchanges: VenueQuote[] = [];
    if (binanceLive) exchanges.push({ exchange: 'Binance P2P', ...binanceLive, source: 'LIVE' });
    if (bybitLive) exchanges.push({ exchange: 'Bybit P2P', ...bybitLive, source: 'LIVE' });
    if (elDoradoLive) exchanges.push({ exchange: 'El Dorado P2P', ...elDoradoLive, source: 'LIVE' });

    const expectedSource = `${EXPECTED_SOURCES.binance}; ${EXPECTED_SOURCES.bybit}; ${EXPECTED_SOURCES.eldorado}`;

    // Total absence: no venue was readable.
    if (exchanges.length === 0) {
      return {
        fiat,
        asset,
        paymentMethod: payment,
        exchanges: [],
        crossArbitrageOpportunity: null,
        rateStatus: 'UNAVAILABLE_NO_LIVE_SOURCE',
        unavailableReason: 'SIN_COTIZACIONES_EN_VIVO',
        expectedSource,
        actionable: false,
        timestamp,
      };
    }

    const rounded = exchanges.map((q) => ({
      exchange: q.exchange,
      buyRate: round2(q.buyRate),
      sellRate: round2(q.sellRate),
      spreadPct: spreadPct(q.buyRate, q.sellRate),
      source: q.source as const,
    }));

    // A single venue is not an arbitrage. The gap between our own bid and ask is
    // a cost of crossing, not an opportunity, so it must not be reported as one.
    if (exchanges.length < 2) {
      return {
        fiat,
        asset,
        paymentMethod: payment,
        exchanges: rounded,
        crossArbitrageOpportunity: null,
        unavailableReason: 'SOLO_UN_VENUE_EN_VIVO',
        expectedSource,
        actionable: false,
        timestamp,
      };
    }

    const lowestBuy = [...exchanges].sort((a, b) => a.buyRate - b.buyRate)[0]!;
    const highestSell = [...exchanges].sort((a, b) => b.sellRate - a.sellRate)[0]!;

    // Same venue on both legs is a spread, not a cross-venue arbitrage.
    if (lowestBuy.exchange === highestSell.exchange) {
      return {
        fiat,
        asset,
        paymentMethod: payment,
        exchanges: rounded,
        crossArbitrageOpportunity: null,
        unavailableReason: 'SIN_DISCREPANCIA_ENTRE_VENUES',
        expectedSource,
        actionable: false,
        timestamp,
      };
    }

    const crossSpreadVes = round2(highestSell.sellRate - lowestBuy.buyRate);
    const crossSpreadPct = Number(((crossSpreadVes / lowestBuy.buyRate) * 100).toFixed(2));

    return {
      fiat,
      asset,
      paymentMethod: payment,
      exchanges: rounded,
      crossArbitrageOpportunity: {
        buyOn: lowestBuy.exchange,
        buyPrice: round2(lowestBuy.buyRate),
        sellOn: highestSell.exchange,
        sellPrice: round2(highestSell.sellRate),
        netSpreadPct: crossSpreadPct,
        isViable: crossSpreadPct >= 1.5,
        estimatedProfitPer1000Usdt: round2(crossSpreadPct * 10),
      },
      expectedSource,
      actionable: false,
      timestamp,
    };
  },
};
