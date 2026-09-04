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
  tradeMethods?: Array<{ identifier?: string; tradeMethodName?: string }>;
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
  updatedAt: string;
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
    if (isNaN(price) || price <= 0) continue;

    const payMethods = (adv.tradeMethods ?? [])
      .map((m) => m.tradeMethodName ?? m.identifier ?? '')
      .filter((m) => m.length > 0);

    offers.push({
      advNo: String(adv.advNo ?? ''),
      price: roundMoney(price, 2),
      merchantName: advertiser?.nickName ?? 'Anónimo',
      finishRatePct: Math.round((advertiser?.monthFinishRate ?? 1) * 100),
      orderCount: advertiser?.monthOrderCount ?? 0,
      minVes: roundMoney(Number(adv.minSingleTransAmount ?? 0), 2),
      maxVes: roundMoney(Number(adv.maxSingleTransAmount ?? 0), 2),
      payMethods,
    });
  }

  return offers;
}

/**
 * Filter offer list by a specific payment method (fuzzy search).
 */
export function filterOffersByPayMethod(
  offers: readonly BinanceOfferSummary[],
  methodName?: string,
): BinanceOfferSummary[] {
  if (!methodName || methodName.trim().length === 0 || methodName.toUpperCase() === 'ALL') {
    return [...offers];
  }
  const norm = methodName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return offers.filter((o) =>
    o.payMethods.some((pm) => pm.toLowerCase().replace(/[^a-z0-9]/g, '').includes(norm)),
  );
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
  const buyOffers = filterOffersByPayMethod(parseBinanceP2pItems(buyAdsRaw), filterMethod);
  const sellOffers = filterOffersByPayMethod(parseBinanceP2pItems(sellAdsRaw), filterMethod);

  // Lowest buy price available
  const bestBuyPrice = buyOffers.length > 0 ? Math.min(...buyOffers.map((o) => o.price)) : 0;

  // Highest sell price available
  const bestSellPrice = sellOffers.length > 0 ? Math.max(...sellOffers.map((o) => o.price)) : 0;

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
    updatedAt: new Date().toISOString(),
  };
}
