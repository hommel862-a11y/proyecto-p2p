/**
 * @file p2p-radar-clean-mode.ts
 * @description P2P Quantitative Intelligence Radar - Core Ingestion, Clean Mode Filtering & Tier Logic.
 * 
 * Strict architectural isolation: Pure mathematical & filtering domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

import { MAKER_FEE_RATES, type MakerMerchantLevel } from './market-scanner';

export type P2PUserTier = 'VERIFIED' | 'UNVERIFIED';
export type TakerEligibilityStatus = 'OPEN' | 'RESTRICTED';

export const RADAR_MERCHANT_LEVEL_FEE_PCT: Record<MakerMerchantLevel, number> = {
  STANDARD: Math.round(MAKER_FEE_RATES.STANDARD * 100000) / 1000,
  BRONZE: Math.round(MAKER_FEE_RATES.BRONZE * 100000) / 1000,
  SILVER: Math.round(MAKER_FEE_RATES.SILVER * 100000) / 1000,
  GOLD: Math.round(MAKER_FEE_RATES.GOLD * 100000) / 1000,
};

export function resolveUserTierFromMerchantLevel(level: MakerMerchantLevel): P2PUserTier {
  return level === 'STANDARD' ? 'UNVERIFIED' : 'VERIFIED';
}

export type RadarOrderSide = 'BUY' | 'SELL';

export type RadarPaymentMethodCode =
  | 'Banesco'
  | 'Mercantil'
  | 'BBVA' // Provincial
  | 'SpecificBank' // Banco de Venezuela in Binance P2P
  | 'PagoMovil'
  | string;

export interface VolumeBracketConfig {
  readonly id: string;
  readonly label: string;
  readonly minAmountVes: number;
}

export const RADAR_VOLUME_BRACKETS: readonly VolumeBracketConfig[] = [
  { id: 'RETAIL_20K', label: 'Menudeo (20k Bs)', minAmountVes: 20_000 },
  { id: 'MEDIUM_150K', label: 'Medio (150k Bs)', minAmountVes: 150_000 },
  { id: 'WHOLESALE_1M', label: 'Mayorista (1M+ Bs)', minAmountVes: 1_000_000 },
] as const;

export interface CleanModeConfig {
  readonly enabled: boolean;
  /** Maximum payment window in minutes (e.g. 15 min; discards 45 min trap ads) */
  readonly maxPayTimeMinutes: number;
  /** Minimum completion percentage in last 30 days (e.g. 92%) */
  readonly minMonthFinishRate: number;
  /** Minimum completed orders in last 30 days (e.g. 30 orders) */
  readonly minMonthOrderCount: number;
  /** Minimum USDT available in advertisement surplus (e.g. 20 USDT) */
  readonly minSurplusUsdt: number;
  /** Minimum required transaction capacity in VES */
  readonly minTransAmountVes: number;
  /** Outlier deviation threshold in percentage against depth baseline (e.g. 0.8%) */
  readonly outlierDeviationPct: number;
  /** Optional max USDT surplus for an offer to qualify as a thin decoy outlier */
  readonly maxOutlierSurplusUsdt?: number;
  /** Optional: hide Verified/Pro Merchant ads to focus on non-merchant niche books */
  readonly excludeMerchantCompetitors?: boolean;
  /** Optional: hide offers with extra counterparty locks (KYC+, reg days, BTC balance) */
  readonly requireOpenTakerEligibility?: boolean;
}

export const DEFAULT_CLEAN_MODE_CONFIG: CleanModeConfig = {
  enabled: true,
  maxPayTimeMinutes: 15,
  minMonthFinishRate: 92.0,
  minMonthOrderCount: 30,
  minSurplusUsdt: 20.0,
  minTransAmountVes: 20_000.0,
  outlierDeviationPct: 0.8,
};

export type FilterRejectionReason =
  | 'PAY_TIME_EXCEEDED'
  | 'LOW_FINISH_RATE'
  | 'LOW_ORDER_COUNT'
  | 'LIQUIDITY_TRAP'
  | 'MANIPULACION_DETECTADA'
  | 'TAKER_RESTRICTED'
  | 'MERCHANT_COMPETITOR_FILTERED';

export interface CleanFilterVerdict {
  readonly passed: boolean;
  readonly reasons: readonly FilterRejectionReason[];
}

export interface RawP2POfferInput {
  readonly advNo: string;
  readonly advertiserNo: string;
  readonly nickName: string;
  readonly price: number;
  readonly surplusAmount: number;
  readonly minSingleTransAmount: number;
  readonly maxSingleTransAmount: number;
  readonly monthOrderCount: number;
  readonly monthFinishRate: number;
  readonly payTimeLimit: number;
  readonly isMerchant: boolean;
  readonly payMethods?: readonly string[];
  readonly userType?: string;
  readonly userGrade?: number | null;
  readonly isProMerchant?: boolean;
  readonly advClassify?: string;
  readonly isSafePayment?: boolean;
  readonly advConfirmTime?: number | null;
  readonly buyerKycLimit?: number | null;
  readonly buyerRegDaysLimit?: number | null;
  readonly buyerBtcPositionLimit?: number | null;
  readonly takerAdditionalKycRequired?: boolean;
}

export interface CleanRadarOffer extends RawP2POfferInput {
  readonly verdict: CleanFilterVerdict;
  readonly isOutlier: boolean;
  readonly isClean: boolean;
  readonly takerEligibility?: TakerEligibilityStatus;
  readonly takerRestrictionReasons?: readonly string[];
  readonly isVerifiedCompetitor?: boolean;
}

export interface BuildCleanRadarBookOptions {
  readonly merchantLevel?: MakerMerchantLevel;
  readonly excludeMerchantCompetitors?: boolean;
  readonly requireOpenTakerEligibility?: boolean;
}

export interface RadarCleanBook {
  readonly side: RadarOrderSide;
  readonly payMethod: string;
  readonly userTier: P2PUserTier;
  readonly merchantLevel?: MakerMerchantLevel;
  readonly rawCount: number;
  readonly cleanCount: number;
  readonly rejectedCount: number;
  readonly cleanOffers: readonly CleanRadarOffer[];
  readonly rejectedOffers: readonly CleanRadarOffer[];
  readonly effectiveTopPrice: number | null;
  readonly makerFeePct: number;
  readonly takerFeePct: number;
  readonly isHybridEligible: boolean;
  readonly merchantWallPct?: number;
  readonly openTakerCount?: number;
  readonly freeAdvertiserCount?: number;
}

export function evaluateOfferEligibility(offer: RawP2POfferInput): {
  takerEligibility: TakerEligibilityStatus;
  takerRestrictionReasons: readonly string[];
  isVerifiedCompetitor: boolean;
} {
  const restrictionReasons: string[] = [];
  if (typeof offer.buyerKycLimit === 'number' && offer.buyerKycLimit > 0) {
    restrictionReasons.push(`KYC_${offer.buyerKycLimit}`);
  }
  if (typeof offer.buyerRegDaysLimit === 'number' && offer.buyerRegDaysLimit > 0) {
    restrictionReasons.push(`REG_${offer.buyerRegDaysLimit}D`);
  }
  if (typeof offer.buyerBtcPositionLimit === 'number' && offer.buyerBtcPositionLimit > 0) {
    restrictionReasons.push(`BTC_${offer.buyerBtcPositionLimit}`);
  }
  if (offer.takerAdditionalKycRequired === true) {
    restrictionReasons.push('EXTRA_KYC');
  }

  const classifyNorm = typeof offer.advClassify === 'string' ? offer.advClassify.trim().toLowerCase() : '';
  const isVerifiedCompetitor =
    offer.isMerchant === true ||
    offer.userType === 'merchant' ||
    offer.isProMerchant === true ||
    (classifyNorm.length > 0 && classifyNorm !== 'mass');

  return {
    takerEligibility: restrictionReasons.length === 0 ? 'OPEN' : 'RESTRICTED',
    takerRestrictionReasons: restrictionReasons,
    isVerifiedCompetitor,
  };
}

/**
 * Evaluates a single P2P advertisement against the Clean Mode rule barrier.
 */
export function auditOfferCleanMode(
  offer: RawP2POfferInput,
  config: CleanModeConfig,
): CleanFilterVerdict {
  if (!config.enabled) {
    const validEnabledOff = Number.isFinite(offer.price) && offer.price > 0;
    return validEnabledOff ? { passed: true, reasons: [] } : { passed: false, reasons: ['LIQUIDITY_TRAP'] };
  }

  const reasons: FilterRejectionReason[] = [];

  // Rule 1: Pay time window check (reject NaN / non-finite / <= 0)
  if (!Number.isFinite(offer.payTimeLimit) || offer.payTimeLimit <= 0 || offer.payTimeLimit > config.maxPayTimeMinutes) {
    reasons.push('PAY_TIME_EXCEEDED');
  }

  // Rule 2: Reliability metrics (order volume & completion rate)
  if (!Number.isFinite(offer.monthFinishRate) || offer.monthFinishRate < config.minMonthFinishRate) {
    reasons.push('LOW_FINISH_RATE');
  }
  if (!Number.isFinite(offer.monthOrderCount) || offer.monthOrderCount < config.minMonthOrderCount) {
    reasons.push('LOW_ORDER_COUNT');
  }

  // Rule 3: Price & Liquidity trap check (valid finite price, available USDT, cap & unfillable ghost check)
  const fiatSurplus = offer.surplusAmount * offer.price;
  const unfillableGhostAd =
    Number.isFinite(offer.minSingleTransAmount) &&
    offer.minSingleTransAmount > 0 &&
    fiatSurplus < offer.minSingleTransAmount;
  const invertedBounds =
    Number.isFinite(offer.minSingleTransAmount) &&
    Number.isFinite(offer.maxSingleTransAmount) &&
    offer.minSingleTransAmount > offer.maxSingleTransAmount;
  if (
    !Number.isFinite(offer.price) ||
    offer.price <= 0 ||
    !Number.isFinite(offer.surplusAmount) ||
    !Number.isFinite(offer.maxSingleTransAmount) ||
    offer.surplusAmount < config.minSurplusUsdt ||
    offer.maxSingleTransAmount < config.minTransAmountVes ||
    unfillableGhostAd ||
    invertedBounds
  ) {
    reasons.push('LIQUIDITY_TRAP');
  }

  const eligibility = evaluateOfferEligibility(offer);
  if (config.requireOpenTakerEligibility && eligibility.takerEligibility === 'RESTRICTED') {
    reasons.push('TAKER_RESTRICTED');
  }
  if (config.excludeMerchantCompetitors && eligibility.isVerifiedCompetitor) {
    reasons.push('MERCHANT_COMPETITOR_FILTERED');
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Detects price outliers and manipulative decoy advertisements at the top of book.
 * Supports single-decoy books (len >= 3) and multi-bot consecutive chains (len >= 5).
 */
export function detectPriceOutliers(
  candidateOffers: readonly RawP2POfferInput[],
  side: RadarOrderSide,
  deviationThresholdPct: number,
  maxOutlierSurplusUsdt?: number,
): Set<string> {
  const outlierAdvNos = new Set<string>();

  if (
    candidateOffers.length < 3 ||
    !Number.isFinite(deviationThresholdPct) ||
    deviationThresholdPct <= 0
  ) {
    return outlierAdvNos;
  }

  const valid = candidateOffers.filter((o) => Number.isFinite(o.price) && o.price > 0);
  if (valid.length < 3) return outlierAdvNos;

  const sorted = [...valid].sort((a, b) => (side === 'BUY' ? b.price - a.price : a.price - b.price));

  let avgBaseline = 0;
  let maxTopCandidates = 1;

  if (sorted.length >= 5) {
    // Use median of deeper core [2..min(len, 6)] so 1-2 top decoy bots cannot poison baseline
    const corePrices = sorted
      .slice(2, Math.min(sorted.length, 6))
      .map((o) => o.price)
      .sort((a, b) => a - b);
    const mid = Math.floor(corePrices.length / 2);
    avgBaseline =
      corePrices.length % 2 === 1
        ? corePrices[mid]
        : (corePrices[mid - 1] + corePrices[mid]) / 2;
    maxTopCandidates = Math.min(3, sorted.length - 3);
  } else {
    avgBaseline = (sorted[1].price + sorted[2].price) / 2.0;
    maxTopCandidates = 1;
  }

  if (!Number.isFinite(avgBaseline) || avgBaseline <= 0) return outlierAdvNos;

  for (let i = 0; i < maxTopCandidates; i++) {
    const candidate = sorted[i];
    const deviationPct = (Math.abs(candidate.price - avgBaseline) / avgBaseline) * 100.0;
    const isThinEnough =
      typeof maxOutlierSurplusUsdt === 'number' && Number.isFinite(maxOutlierSurplusUsdt)
        ? candidate.surplusAmount <= maxOutlierSurplusUsdt
        : true;

    if (deviationPct >= deviationThresholdPct && isThinEnough) {
      outlierAdvNos.add(candidate.advNo);
    } else {
      break;
    }
  }

  return outlierAdvNos;
}

/**
 * Computes the capital-weighted executable VWAP price across sorted clean offers until `capitalUsdt` is filled.
 * Prevents "Top-1 $30 illusion" when evaluating $500+ operating tickets.
 */
export function computeExecutableCapitalPrice(
  cleanOffers: readonly CleanRadarOffer[],
  capitalUsdt: number,
): { executablePrice: number | null; coveragePct: number } {
  if (cleanOffers.length === 0) {
    return { executablePrice: null, coveragePct: 0 };
  }
  if (!Number.isFinite(capitalUsdt) || capitalUsdt <= 0) {
    const first = cleanOffers[0];
    return {
      executablePrice: Number.isFinite(first.price) && first.price > 0 ? first.price : null,
      coveragePct: 100,
    };
  }

  let remainingUsdt = capitalUsdt;
  let filledUsdt = 0;
  let weightedFiat = 0;

  for (const offer of cleanOffers) {
    if (!Number.isFinite(offer.price) || offer.price <= 0) continue;
    const avail = Number.isFinite(offer.surplusAmount) && offer.surplusAmount > 0 ? offer.surplusAmount : 0;
    if (avail <= 0) continue;
    const take = Math.min(remainingUsdt, avail);
    weightedFiat += take * offer.price;
    filledUsdt += take;
    remainingUsdt -= take;
    if (remainingUsdt <= 1e-6) break;
  }

  if (filledUsdt <= 0) {
    const first = cleanOffers[0];
    return {
      executablePrice: Number.isFinite(first.price) && first.price > 0 ? first.price : null,
      coveragePct: 0,
    };
  }

  const coveragePct = Math.min(100, Math.round((filledUsdt / capitalUsdt) * 100));
  return {
    executablePrice: Math.round((weightedFiat / filledUsdt) * 10000) / 10000,
    coveragePct,
  };
}

/**
 * Complete Pipeline: filters, scrubs and indexes an entire P2P order book for a given fiat/bank leg.
 */
export function buildCleanRadarBook(
  rawOffers: readonly RawP2POfferInput[],
  side: RadarOrderSide,
  payMethod: string,
  userTier: P2PUserTier,
  config: CleanModeConfig = DEFAULT_CLEAN_MODE_CONFIG,
  options?: BuildCleanRadarBookOptions,
): RadarCleanBook {
  const effectiveConfig: CleanModeConfig = {
    ...config,
    excludeMerchantCompetitors:
      options?.excludeMerchantCompetitors ?? config.excludeMerchantCompetitors,
    requireOpenTakerEligibility:
      options?.requireOpenTakerEligibility ?? config.requireOpenTakerEligibility,
  };

  // Step 1: Audit base Clean Mode rules first so trap ads do not skew the #2/#3 outlier baseline
  const baseVerdicts = rawOffers.map((raw) => auditOfferCleanMode(raw, effectiveConfig));
  const cleanEligibleOffers: RawP2POfferInput[] = [];
  for (let i = 0; i < rawOffers.length; i++) {
    if (baseVerdicts[i].passed) {
      cleanEligibleOffers.push(rawOffers[i]);
    }
  }

  const outlierCandidatePool = cleanEligibleOffers.length >= 3 ? cleanEligibleOffers : rawOffers;
  const outlierSet = effectiveConfig.enabled
    ? detectPriceOutliers(
        outlierCandidatePool,
        side,
        effectiveConfig.outlierDeviationPct,
        effectiveConfig.maxOutlierSurplusUsdt,
      )
    : new Set<string>();

  const cleanOffers: CleanRadarOffer[] = [];
  const rejectedOffers: CleanRadarOffer[] = [];

  for (let i = 0; i < rawOffers.length; i++) {
    const raw = rawOffers[i];
    const baseVerdict = baseVerdicts[i];
    const isOutlier = outlierSet.has(raw.advNo);
    const eligibility = evaluateOfferEligibility(raw);

    const reasons = [...baseVerdict.reasons];
    if (isOutlier) {
      reasons.push('MANIPULACION_DETECTADA');
    }

    const isClean = baseVerdict.passed && !isOutlier;

    const cleanOffer: CleanRadarOffer = {
      ...raw,
      verdict: {
        passed: isClean,
        reasons,
      },
      isOutlier,
      isClean,
      takerEligibility: eligibility.takerEligibility,
      takerRestrictionReasons: eligibility.takerRestrictionReasons,
      isVerifiedCompetitor: eligibility.isVerifiedCompetitor,
    };

    if (isClean) {
      cleanOffers.push(cleanOffer);
    } else {
      rejectedOffers.push(cleanOffer);
    }
  }

  // Sort clean offers optimally for execution
  cleanOffers.sort((a, b) => (side === 'BUY' ? b.price - a.price : a.price - b.price));

  const effectiveTopPrice = cleanOffers.length > 0 ? cleanOffers[0].price : null;

  // Competitive market wall metrics (Top-10 raw window excluding outright traps)
  const marketWindow = rawOffers.slice(0, 10);
  let merchantCount = 0;
  let freeCount = 0;
  let openCount = 0;
  for (const offer of marketWindow) {
    const el = evaluateOfferEligibility(offer);
    if (el.isVerifiedCompetitor) {
      merchantCount++;
    } else {
      freeCount++;
    }
    if (el.takerEligibility === 'OPEN') {
      openCount++;
    }
  }
  const merchantWallPct =
    marketWindow.length > 0 ? Math.round((merchantCount / marketWindow.length) * 100) : 0;

  // Canonical MakerMerchantLevel fee parity (when provided), preserving legacy 5-arg tier behavior
  const merchantLevel = options?.merchantLevel;
  const makerFeePct = merchantLevel
    ? RADAR_MERCHANT_LEVEL_FEE_PCT[merchantLevel]
    : userTier === 'VERIFIED'
      ? 0.10
      : 0.20;
  const takerFeePct = 0.0;
  const isHybridEligible = merchantLevel ? merchantLevel === 'STANDARD' : userTier === 'UNVERIFIED';

  return {
    side,
    payMethod,
    userTier,
    merchantLevel,
    rawCount: rawOffers.length,
    cleanCount: cleanOffers.length,
    rejectedCount: rejectedOffers.length,
    cleanOffers,
    rejectedOffers,
    effectiveTopPrice,
    makerFeePct,
    takerFeePct,
    isHybridEligible,
    merchantWallPct,
    openTakerCount: openCount,
    freeAdvertiserCount: freeCount,
  };
}
