/**
 * @file p2p-radar-clean-mode.ts
 * @description P2P Quantitative Intelligence Radar - Core Ingestion, Clean Mode Filtering & Tier Logic.
 * 
 * Strict architectural isolation: Pure mathematical & filtering domain logic.
 * Zero UI/Angular dependencies. Compatible with Vitest, Node.js and Electron.
 */

export type P2PUserTier = 'VERIFIED' | 'UNVERIFIED';

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
  | 'MANIPULACION_DETECTADA';

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
}

export interface CleanRadarOffer extends RawP2POfferInput {
  readonly verdict: CleanFilterVerdict;
  readonly isOutlier: boolean;
  readonly isClean: boolean;
}

export interface RadarCleanBook {
  readonly side: RadarOrderSide;
  readonly payMethod: string;
  readonly userTier: P2PUserTier;
  readonly rawCount: number;
  readonly cleanCount: number;
  readonly rejectedCount: number;
  readonly cleanOffers: readonly CleanRadarOffer[];
  readonly rejectedOffers: readonly CleanRadarOffer[];
  readonly effectiveTopPrice: number | null;
  readonly makerFeePct: number;
  readonly takerFeePct: number;
  readonly isHybridEligible: boolean;
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

  // Rule 1: Pay time window check (reject NaN / non-finite)
  if (!Number.isFinite(offer.payTimeLimit) || offer.payTimeLimit < 0 || offer.payTimeLimit > config.maxPayTimeMinutes) {
    reasons.push('PAY_TIME_EXCEEDED');
  }

  // Rule 2: Reliability metrics (order volume & completion rate)
  if (!Number.isFinite(offer.monthFinishRate) || offer.monthFinishRate < config.minMonthFinishRate) {
    reasons.push('LOW_FINISH_RATE');
  }
  if (!Number.isFinite(offer.monthOrderCount) || offer.monthOrderCount < config.minMonthOrderCount) {
    reasons.push('LOW_ORDER_COUNT');
  }

  // Rule 3: Price & Liquidity trap check (valid finite price, available USDT, and single trans cap)
  if (
    !Number.isFinite(offer.price) ||
    offer.price <= 0 ||
    !Number.isFinite(offer.surplusAmount) ||
    !Number.isFinite(offer.maxSingleTransAmount) ||
    offer.surplusAmount < config.minSurplusUsdt ||
    offer.maxSingleTransAmount < config.minTransAmountVes
  ) {
    reasons.push('LIQUIDITY_TRAP');
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * Detects price outliers and manipulative decoy advertisements at the top of book in O(n) single pass.
 *
 * If offer #1 deviates significantly from the average of #2 and #3, it is isolated as MANIPULACION_DETECTADA
 * so it does not skew the execution rate.
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

  // Single-pass O(n) top-3 selection (avoids full O(n log n) sort allocation)
  const isBetter =
    side === 'BUY'
      ? (a: RawP2POfferInput, b: RawP2POfferInput) => a.price > b.price
      : (a: RawP2POfferInput, b: RawP2POfferInput) => a.price < b.price;

  let top1: RawP2POfferInput | null = null;
  let top2: RawP2POfferInput | null = null;
  let top3: RawP2POfferInput | null = null;

  for (const offer of candidateOffers) {
    if (!Number.isFinite(offer.price) || offer.price <= 0) continue;
    if (!top1 || isBetter(offer, top1)) {
      top3 = top2;
      top2 = top1;
      top1 = offer;
    } else if (!top2 || isBetter(offer, top2)) {
      top3 = top2;
      top2 = offer;
    } else if (!top3 || isBetter(offer, top3)) {
      top3 = offer;
    }
  }

  if (!top1 || !top2 || !top3) return outlierAdvNos;

  const avgBaseline = (top2.price + top3.price) / 2.0;
  if (avgBaseline <= 0) return outlierAdvNos;

  const deviationPct = (Math.abs(top1.price - avgBaseline) / avgBaseline) * 100.0;
  const isThinEnough =
    typeof maxOutlierSurplusUsdt === 'number' && Number.isFinite(maxOutlierSurplusUsdt)
      ? top1.surplusAmount <= maxOutlierSurplusUsdt
      : true;

  if (deviationPct >= deviationThresholdPct && isThinEnough) {
    outlierAdvNos.add(top1.advNo);
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
): RadarCleanBook {
  // Step 1: Audit base Clean Mode rules first so trap ads do not skew the #2/#3 outlier baseline
  const baseVerdicts = rawOffers.map((raw) => auditOfferCleanMode(raw, config));
  const cleanEligibleOffers: RawP2POfferInput[] = [];
  for (let i = 0; i < rawOffers.length; i++) {
    if (baseVerdicts[i].passed) {
      cleanEligibleOffers.push(rawOffers[i]);
    }
  }

  const outlierCandidatePool = cleanEligibleOffers.length >= 3 ? cleanEligibleOffers : rawOffers;
  const outlierSet = config.enabled
    ? detectPriceOutliers(outlierCandidatePool, side, config.outlierDeviationPct)
    : new Set<string>();

  const cleanOffers: CleanRadarOffer[] = [];
  const rejectedOffers: CleanRadarOffer[] = [];

  for (let i = 0; i < rawOffers.length; i++) {
    const raw = rawOffers[i];
    const baseVerdict = baseVerdicts[i];
    const isOutlier = outlierSet.has(raw.advNo);

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

  // Tier fee economics
  // Verified merchants typically enjoy 0.10% maker fees in Binance P2P.
  // Unverified/Standard makers face 0.20% (or 0.35% depending on VIP).
  // Taker fee is always 0.00% on Binance P2P.
  const makerFeePct = userTier === 'VERIFIED' ? 0.10 : 0.20;
  const takerFeePct = 0.0;
  const isHybridEligible = userTier === 'UNVERIFIED';

  return {
    side,
    payMethod,
    userTier,
    rawCount: rawOffers.length,
    cleanCount: cleanOffers.length,
    rejectedCount: rejectedOffers.length,
    cleanOffers,
    rejectedOffers,
    effectiveTopPrice,
    makerFeePct,
    takerFeePct,
    isHybridEligible,
  };
}
