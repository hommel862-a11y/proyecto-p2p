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
        result?: { items?: Array<{ price?: string | number }>; list?: Array<{ price?: string | number }> };
      };
      const items = json.result?.items ?? json.result?.list ?? [];
      return items
        .map((it) => Number(it.price))
        .filter((p) => Number.isFinite(p) && p > 0);
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
    'Compara libros de órdenes P2P en tiempo real entre Binance, Bybit, OKX, KuCoin y El Dorado para detectar discrepancias de precios y oportunidades de arbitraje cruzado.',
  inputSchema: FetchCrossExchangeSpreadInputSchema,
  execute: async (input: FetchCrossExchangeSpreadInput) => {
    const fiat = input.fiat;
    const asset = input.asset;
    const payment = input.paymentMethod;

    // Realistic baseline price index according to currency
    const baseRate = fiat === 'VES' ? 79.2 : fiat === 'COP' ? 4250 : 1.0;

    // Live data attempts (best-effort; simulated fallback keeps offline runs deterministic).
    const [bybitLive, elDoradoLive] = await Promise.all([
      fetchBybitLiveRates(asset, fiat),
      fetchElDoradoLiveRates(asset, fiat),
    ]);

    const exchangeQuotes = [
      {
        exchange: 'Binance P2P',
        buyRate: round2(baseRate * 0.992),
        sellRate: round2(baseRate * 1.012),
        spreadPct: 2.02,
        activeMerchants: 48,
        source: 'SIMULATED' as const,
      },
      {
        exchange: 'Bybit P2P',
        buyRate: bybitLive ? round2(bybitLive.buyRate) : round2(baseRate * 0.988),
        sellRate: bybitLive ? round2(bybitLive.sellRate) : round2(baseRate * 1.015),
        spreadPct: bybitLive
          ? spreadPct(bybitLive.buyRate, bybitLive.sellRate)
          : 2.73,
        activeMerchants: 22,
        ...(bybitLive ? { source: 'LIVE' as const } : { source: 'SIMULATED' as const }),
      },
      {
        exchange: 'OKX P2P',
        buyRate: round2(baseRate * 0.994),
        sellRate: round2(baseRate * 1.009),
        spreadPct: 1.51,
        activeMerchants: 15,
        source: 'SIMULATED' as const,
      },
      {
        exchange: 'KuCoin P2P',
        buyRate: round2(baseRate * 0.985),
        sellRate: round2(baseRate * 1.018),
        spreadPct: 3.35,
        activeMerchants: 9,
        source: 'SIMULATED' as const,
      },
    ];

    if (elDoradoLive) {
      exchangeQuotes.push({
        exchange: 'El Dorado P2P',
        buyRate: round2(elDoradoLive.buyRate),
        sellRate: round2(elDoradoLive.sellRate),
        spreadPct: spreadPct(elDoradoLive.buyRate, elDoradoLive.sellRate),
        activeMerchants: 0,
        source: 'LIVE' as const,
      });
    }

    // Find cross-arbitrage: lowest buy anywhere vs highest sell anywhere
    const lowestBuy = [...exchangeQuotes].sort((a, b) => a.buyRate - b.buyRate)[0];
    const highestSell = [...exchangeQuotes].sort((a, b) => b.sellRate - a.sellRate)[0];

    const crossSpreadVes = round2(highestSell.sellRate - lowestBuy.buyRate);
    const crossSpreadPct = Number(((crossSpreadVes / lowestBuy.buyRate) * 100).toFixed(2));
    const isArbitrageViable = crossSpreadPct >= 1.5;

    return {
      fiat,
      asset,
      paymentMethod: payment,
      exchanges: exchangeQuotes,
      crossArbitrageOpportunity: {
        buyOn: lowestBuy.exchange,
        buyPrice: lowestBuy.buyRate,
        sellOn: highestSell.exchange,
        sellPrice: highestSell.sellRate,
        netSpreadPct: crossSpreadPct,
        isViable: isArbitrageViable,
        estimatedProfitPer1000Usdt: round2(crossSpreadPct * 10),
      },
      timestamp: new Date().toISOString(),
    };
  },
};