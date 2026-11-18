/**
 * Pure Binance P2P API parser and orderbook depth domain logic.
 * Parses raw Binance C2C adv search responses, extracts top maker/taker offers,
 * filters by local Venezuelan payment methods (Banesco, Pago Móvil), and computes live spreads.
 * Framework-agnostic. No network, no Angular.
 */

import { roundMoney } from './money';

export interface BinanceP2pRawAd {
  advNo?: string;
  price?: string | number;
  fiatUnit?: string;
  asset?: string;
  surplusAmount?: string | number;
  minSingleTransAmount?: string | number;
  maxSingleTransAmount?: string | number;
  tradeMethods?: { identifier?: string; tradeMethodName?: string }[];
}

export interface BinanceP2pRawAdvertiser {
  userNo?: string;
  nickName?: string;
  monthOrderCount?: number;
  monthFinishRate?: number;
}

export interface BinanceP2pRawItem {
  adv?: BinanceP2pRawAd;
  advertiser?: BinanceP2pRawAdvertiser;
}

export interface BinanceOfferSummary {
  advNo: string;
  price: number;
  merchantName: string;
  finishRatePct: number;
  orderCount: number;
  minVes: number;
  maxVes: number;
  payMethods: string[];
}

export interface BinanceP2pMarketDepth {
  asset: string;
  fiat: string;
  bestBuyPrice: number;
  bestSellPrice: number;
  spreadVes: number;
  spreadPct: number;
  buyOffers: BinanceOfferSummary[];
  sellOffers: BinanceOfferSummary[];
  /** Full sorted offers (up to 20 per side) for deep microstructure/VWAP engines. */
  fullBuyOffers?: BinanceOfferSummary[];
  /** Full sorted offers (up to 20 per side) for deep microstructure/VWAP engines. */
  fullSellOffers?: BinanceOfferSummary[];
  updatedAt: string;
}

/**
 * Returns full-depth offers when available, falling back to top-5 `buyOffers`/`sellOffers`.
 */
export function getFullDepthOffers(
  depth: BinanceP2pMarketDepth | null | undefined,
  side: 'BUY' | 'SELL',
): BinanceOfferSummary[] {
  if (!depth) return [];
  if (side === 'BUY') {
    return depth.fullBuyOffers && depth.fullBuyOffers.length > 0
      ? depth.fullBuyOffers
      : (depth.buyOffers ?? []);
  }
  return depth.fullSellOffers && depth.fullSellOffers.length > 0
    ? depth.fullSellOffers
    : (depth.sellOffers ?? []);
}

/**
 * Normalized payment method names mapped to Binance P2P payType strings.
 */
export const BINANCE_PAY_METHODS: Record<string, string> = {
  ALL: '',
  BANESCO: 'Banesco',
  PAGO_MOVIL: 'PagoMovil',
  MERCANTIL: 'Mercantil',
  BDV: 'BancoDeVenezuela',
  PROVINCIAL: 'BBVAProvincial',
  BANCAMIGA: 'Bancamiga',
  BNC: 'BancoNacionalDeCredito',
  BANCARIBE: 'Bancaribe',
  BANPLUS: 'Banplus',
};

/**
 * Build standard payload for Binance P2P public adv search.
 */
export function buildBinanceSearchPayload(
  asset = 'USDT',
  fiat = 'VES',
  tradeType: 'BUY' | 'SELL' = 'BUY',
  bankPayType?: string,
  rows = 10,
): {
  asset: string;
  fiat: string;
  tradeType: string;
  page: number;
  rows: number;
  payTypes: string[];
  countries: string[];
  proMerchantAds: boolean;
  shieldMerchantAds: boolean;
  filterType: string;
  periods: string[];
} {
  return {
    asset,
    fiat,
    tradeType,
    page: 1,
    rows: Math.min(20, Math.max(1, rows)),
    payTypes: bankPayType && bankPayType.length > 0 ? [bankPayType] : [],
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    filterType: 'all',
    periods: [],
  };
}

/**
 * Safely parse raw response array from Binance C2C API.
 */
export function parseBinanceP2pItems(data: unknown): BinanceOfferSummary[] {
  if (!data) return [];
  const items = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data;
  if (!Array.isArray(items)) return [];

  const offers: BinanceOfferSummary[] = [];

  for (const item of items as BinanceP2pRawItem[]) {
    const adv = item?.adv;
    const advertiser = item?.advertiser;
    if (!adv || !adv.price) continue;

    const price = Number(adv.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    const rawMin = Number(adv.minSingleTransAmount ?? 0);
    const rawMax = Number(adv.maxSingleTransAmount ?? 0);
    const rawFinish = Number(advertiser?.monthFinishRate ?? 1);
    const rawOrders = Number(advertiser?.monthOrderCount ?? 0);

    const payMethods = (adv.tradeMethods ?? [])
      .map((m) => m.tradeMethodName ?? m.identifier ?? '')
      .filter((m) => m.length > 0);

    offers.push({
      advNo: String(adv.advNo ?? ''),
      price: roundMoney(price, 2),
      merchantName: advertiser?.nickName ?? 'Anónimo',
      finishRatePct: Number.isFinite(rawFinish) ? Math.round(rawFinish * 100) : 100,
      orderCount: Number.isFinite(rawOrders) ? rawOrders : 0,
      minVes: Number.isFinite(rawMin) && rawMin >= 0 ? roundMoney(rawMin, 2) : 0,
      maxVes: Number.isFinite(rawMax) && rawMax >= 0 ? roundMoney(rawMax, 2) : 0,
      payMethods,
    });
  }

  return offers;
}

function normalizeMethod(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Filter offer list by a specific payment method (fuzzy search, accent-insensitive).
 */
export function filterOffersByPayMethod(
  offers: readonly BinanceOfferSummary[],
  methodName?: string,
): BinanceOfferSummary[] {
  if (!methodName || methodName.trim().length === 0 || methodName.toUpperCase() === 'ALL') {
    return [...offers];
  }
  const norm = normalizeMethod(methodName);
  return offers.filter((o) => o.payMethods.some((pm) => normalizeMethod(pm).includes(norm)));
}

/**
 * Extract unified market depth and spread metrics from buy and sell offer lists.
 * In Binance P2P terminology:
 * - When tradeType = "BUY": ads published by makers selling crypto (your buy price as a taker).
 * - When tradeType = "SELL": ads published by makers buying crypto (your sell price as a taker).
 */
export function computeMarketDepth(
  buyAdsRaw: unknown,
  sellAdsRaw: unknown,
  asset = 'USDT',
  fiat = 'VES',
  filterMethod?: string,
): BinanceP2pMarketDepth {
  const buyOffers = filterOffersByPayMethod(parseBinanceP2pItems(buyAdsRaw), filterMethod).sort(
    (a, b) => a.price - b.price,
  );
  const sellOffers = filterOffersByPayMethod(parseBinanceP2pItems(sellAdsRaw), filterMethod).sort(
    (a, b) => b.price - a.price,
  );

  // Lowest buy price available
  const bestBuyPrice = buyOffers.length > 0 ? buyOffers[0].price : 0;

  // Highest sell price available
  const bestSellPrice = sellOffers.length > 0 ? sellOffers[0].price : 0;

  let spreadVes = 0;
  let spreadPct = 0;

  if (bestBuyPrice > 0 && bestSellPrice > 0) {
    spreadVes = roundMoney(bestSellPrice - bestBuyPrice, 2);
    spreadPct = roundMoney((spreadVes / bestBuyPrice) * 100, 2);
  }

  return {
    asset,
    fiat,
    bestBuyPrice,
    bestSellPrice,
    spreadVes,
    spreadPct,
    buyOffers: buyOffers.slice(0, 5),
    sellOffers: sellOffers.slice(0, 5),
    fullBuyOffers: buyOffers.slice(0, 20),
    fullSellOffers: sellOffers.slice(0, 20),
    updatedAt: new Date().toISOString(),
  };
}
