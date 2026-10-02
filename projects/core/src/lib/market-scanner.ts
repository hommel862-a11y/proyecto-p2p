/**
 * Pure domain logic for High-Demand Market Scanner (Radar de Alta Demanda).
 * Evaluates live Binance P2P orderbook by capital tiers (>= 1,000 USDT),
 * filters ghost liquidity / low-reputation competitors, deducts official Maker fees
 * according to user merchant level (Unverified/Standard, Bronze, Silver, Gold),
 * and computes micro-undercut optimal posting prices (±0.01 Bs).
 *
 * Deterministic, zero network, zero Angular dependencies.
 */

import { roundMoney } from './money';
import type { BinanceOfferSummary, BinanceP2pMarketDepth } from './binance-p2p';

/**
 * Standard capital tiers for high-demand / institutional P2P trading.
 * Only volumes >= 1,000 USDT are considered.
 */
export const HIGH_DEMAND_TIERS_USDT = [1000, 2500, 5000, 10000] as const;
export type HighDemandTierUsdt = (typeof HIGH_DEMAND_TIERS_USDT)[number];

/**
 * Official Binance P2P Maker fee schedule.
 * Standard / Unverified merchants pay 0.25%, while VIP merchants get fee discounts.
 */
export type MakerMerchantLevel = 'STANDARD' | 'BRONZE' | 'SILVER' | 'GOLD';

export const MAKER_FEE_RATES: Record<MakerMerchantLevel, number> = {
  STANDARD: 0.0025, // 0.25% (No verificado / Comerciante estándar)
  BRONZE: 0.002, // 0.20%
  SILVER: 0.00175, // 0.175%
  GOLD: 0.00125, // 0.125%
};

export interface CompetitorFilterCriteria {
  /** Minimum monthly order completion rate (0-100). Default: 90 */
  minFinishRatePct?: number;
  /** Minimum monthly completed order count. Default: 50 */
  minOrderCount?: number;
}

export interface HighDemandScanOptions {
  /** Target merchant level for accurate Maker fee deduction. Default: STANDARD */
  merchantLevel?: MakerMerchantLevel;
  /** Filter criteria to discard ghost liquidity or unreliable traders. */
  filterCriteria?: CompetitorFilterCriteria;
  /** Specific bank or payment method filter. If omitted or 'ALL', evaluates all methods. */
  bankFilter?: string;
  /** Break-even floor selling price to prevent selling at a loss. */
  breakEvenSellPrice?: number;
  /** Max acceptable buying price to prevent overpaying. */
  maxBuyPrice?: number;
  /** Volatility safety cushion in VES (e.g. 0.10 Bs) if market is unstable. Default: 0.01 */
  stepVes?: number;
}

export interface TierOpportunityRow {
  tierUsdt: number;
  tierVes: number;
  qualifiedBuyOffersCount: number;
  qualifiedSellOffersCount: number;
  bestCompetitorBuyPrice: number;
  bestCompetitorSellPrice: number;
  suggestedBuyPrice: number;
  suggestedSellPrice: number;
  grossSpreadVes: number;
  grossSpreadPct: number;
  makerFeeBuyPct: number;
  makerFeeSellPct: number;
  totalFeePct: number;
  netSpreadVes: number;
  netSpreadPct: number;
  netProfitVesPerCycle: number;
  netProfitUsdtPerCycle: number;
  /** Priority score based on profitability and capital velocity */
  opportunityScore: number;
  isActionable: boolean;
  statusNote: string;
}

export interface HighDemandScanResult {
  asset: string;
  fiat: string;
  bankFilter: string;
  merchantLevel: MakerMerchantLevel;
  makerFeeRatePct: number;
  scannedAt: string;
  tiers: TierOpportunityRow[];
  bestOpportunityTier: TierOpportunityRow | null;
}

/**
 * Filters out ghost / low-reputation advertisers.
 */
export function filterQualifiedCompetitors(
  offers: readonly BinanceOfferSummary[],
  criteria: CompetitorFilterCriteria = {},
): BinanceOfferSummary[] {
  const minRate = criteria.minFinishRatePct ?? 90;
  const minCount = criteria.minOrderCount ?? 50;

  return offers.filter((o) => {
    return o.finishRatePct >= minRate && o.orderCount >= minCount && o.price > 0;
  });
}

/**
 * Normalizes payment method string for comparison.
 */
function normalizePaymentMethod(method: string): string {
  return method.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks whether an offer matches the selected bank/payment filter.
 */
function offerMatchesBank(offer: BinanceOfferSummary, bankFilter?: string): boolean {
  if (!bankFilter || bankFilter.toUpperCase() === 'ALL' || bankFilter.trim().length === 0) {
    return true;
  }
  const normFilter = normalizePaymentMethod(bankFilter);
  return offer.payMethods.some((pm) => normalizePaymentMethod(pm).includes(normFilter));
}

/**
 * Checks whether an offer's limits [minVes, maxVes] can absorb the target capital in VES.
 */
export function offerAbsorbsCapital(offer: BinanceOfferSummary, targetCapitalVes: number): boolean {
  if (targetCapitalVes <= 0) return true;
  // If maxVes is set and positive, it must be >= targetCapital
  if (offer.maxVes > 0 && offer.maxVes < targetCapitalVes) {
    return false;
  }
  // If minVes is higher than targetCapital, the ad requires more than the user intends to trade
  if (offer.minVes > targetCapitalVes) {
    return false;
  }
  return true;
}

/**
 * Computes the High-Demand Market Scan across capital tiers starting from 1,000 USDT.
 */
export function computeHighDemandScan(
  depth: BinanceP2pMarketDepth | null,
  options: HighDemandScanOptions = {},
): HighDemandScanResult {
  const merchantLevel = options.merchantLevel ?? 'STANDARD';
  const makerFeeRate = MAKER_FEE_RATES[merchantLevel] ?? 0.0025;
  const makerFeeRatePct = roundMoney(makerFeeRate * 100, 3);
  const stepVes = options.stepVes && options.stepVes > 0 ? options.stepVes : 0.01;
  const bankFilter = options.bankFilter?.trim() || 'ALL';

  const emptyResult: HighDemandScanResult = {
    asset: depth?.asset ?? 'USDT',
    fiat: depth?.fiat ?? 'VES',
    bankFilter,
    merchantLevel,
    makerFeeRatePct,
    scannedAt: depth?.updatedAt ?? new Date().toISOString(),
    tiers: [],
    bestOpportunityTier: null,
  };

  if (!depth || depth.bestBuyPrice <= 0 || depth.bestSellPrice <= 0) {
    return emptyResult;
  }

  // Reference exchange rate to convert USDT tiers to VES
  const refRate = (depth.bestBuyPrice + depth.bestSellPrice) / 2;

  // 1. Filter qualified competitors
  const qualifiedBuys = filterQualifiedCompetitors(
    depth.buyOffers ?? [],
    options.filterCriteria,
  ).filter((o) => offerMatchesBank(o, bankFilter));

  const qualifiedSells = filterQualifiedCompetitors(
    depth.sellOffers ?? [],
    options.filterCriteria,
  ).filter((o) => offerMatchesBank(o, bankFilter));

  const tiers: TierOpportunityRow[] = [];

  for (const tierUsdt of HIGH_DEMAND_TIERS_USDT) {
    const tierVes = roundMoney(tierUsdt * refRate, 2);

    // Offers absorbing this tier
    const eligibleBuys = qualifiedBuys.filter((o) => offerAbsorbsCapital(o, tierVes));
    const eligibleSells = qualifiedSells.filter((o) => offerAbsorbsCapital(o, tierVes));

    // Sort: BUY side (maker buys / competitor buys) -> highest price first
    eligibleBuys.sort((a, b) => b.price - a.price);
    // Sort: SELL side (maker sells / competitor sells) -> lowest price first
    eligibleSells.sort((a, b) => a.price - b.price);

    const bestCompBuy = eligibleBuys.length > 0 ? eligibleBuys[0].price : 0;
    const bestCompSell = eligibleSells.length > 0 ? eligibleSells[0].price : 0;

    let suggestedBuy = bestCompBuy > 0 ? roundMoney(bestCompBuy + stepVes, 2) : 0;
    let suggestedSell = bestCompSell > 0 ? roundMoney(bestCompSell - stepVes, 2) : 0;

    // Safety guards
    if (options.maxBuyPrice && options.maxBuyPrice > 0 && suggestedBuy > options.maxBuyPrice) {
      suggestedBuy = roundMoney(options.maxBuyPrice, 2);
    }
    if (
      options.breakEvenSellPrice &&
      options.breakEvenSellPrice > 0 &&
      suggestedSell < options.breakEvenSellPrice
    ) {
      suggestedSell = roundMoney(options.breakEvenSellPrice, 2);
    }

    const hasTwoSidedMarket = suggestedBuy > 0 && suggestedSell > 0;
    let grossSpreadVes = 0;
    let grossSpreadPct = 0;
    let netSpreadVes = 0;
    let netSpreadPct = 0;
    let netProfitVes = 0;
    let netProfitUsdt = 0;
    let isActionable = false;
    let statusNote = 'Sin liquidez calificada en ambos lados para este tramo';

    const totalFeePct = roundMoney(makerFeeRatePct * 2, 3); // fee on buy + fee on sell

    if (hasTwoSidedMarket) {
      grossSpreadVes = roundMoney(suggestedSell - suggestedBuy, 2);
      grossSpreadPct = roundMoney((grossSpreadVes / suggestedBuy) * 100, 2);

      // Deduct exact Maker fees
      netSpreadPct = roundMoney(grossSpreadPct - totalFeePct, 2);
      netSpreadVes = roundMoney(suggestedBuy * (netSpreadPct / 100), 2);

      netProfitVes = roundMoney(tierUsdt * netSpreadVes, 2);
      netProfitUsdt = roundMoney(netProfitVes / suggestedSell, 2);

      if (netSpreadPct > 0) {
        isActionable = true;
        statusNote = `Spread neto positivo (+${netSpreadPct}%) descontando comisiones Maker (${makerFeeRatePct}% x 2)`;
      } else {
        isActionable = false;
        statusNote = `Spread comprimido: el margen bruto (+${grossSpreadPct}%) no cubre comisiones (${totalFeePct}%)`;
      }
    }

    // Opportunity score: weight net margin with liquidity demand
    // Tiers of 1,000-2,500 rotate faster than 10,000, but higher capital yields more nominal profit
    const velocityFactor = tierUsdt === 1000 ? 1.3 : tierUsdt === 2500 ? 1.2 : tierUsdt === 5000 ? 1.0 : 0.8;
    const opportunityScore = isActionable ? roundMoney(netSpreadPct * velocityFactor, 2) : 0;

    tiers.push({
      tierUsdt,
      tierVes,
      qualifiedBuyOffersCount: eligibleBuys.length,
      qualifiedSellOffersCount: eligibleSells.length,
      bestCompetitorBuyPrice: bestCompBuy,
      bestCompetitorSellPrice: bestCompSell,
      suggestedBuyPrice: suggestedBuy,
      suggestedSellPrice: suggestedSell,
      grossSpreadVes,
      grossSpreadPct,
      makerFeeBuyPct: makerFeeRatePct,
      makerFeeSellPct: makerFeeRatePct,
      totalFeePct,
      netSpreadVes,
      netSpreadPct,
      netProfitVesPerCycle: netProfitVes,
      netProfitUsdtPerCycle: netProfitUsdt,
      opportunityScore,
      isActionable,
      statusNote,
    });
  }

  // Find best opportunity tier
  const actionableTiers = tiers.filter((t) => t.isActionable);
  actionableTiers.sort((a, b) => b.opportunityScore - a.opportunityScore);
  const bestOpportunityTier = actionableTiers.length > 0 ? actionableTiers[0] : null;

  return {
    ...emptyResult,
    tiers,
    bestOpportunityTier,
  };
}
