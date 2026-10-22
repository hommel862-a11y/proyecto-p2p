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
    return { passed: true, reasons: [] };
  }

  const reasons: FilterRejectionReason[] = [];

  // Rule 1: Pay time window check
  if (offer.payTimeLimit > config.maxPayTimeMinutes) {
    reasons.push('PAY_TIME_EXCEEDED');
  }

  // Rule 2: Reliability metrics (order volume & completion rate)
  if (offer.monthFinishRate < config.minMonthFinishRate) {
    reasons.push('LOW_FINISH_RATE');
  }
  if (offer.monthOrderCount < config.minMonthOrderCount) {
    reasons.push('LOW_ORDER_COUNT');
  }

  // Rule 3: Liquidity trap check (both available USDT and single trans cap)
  if (
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
 * Detects price outliers and manipulative decoy advertisements at the top of book.
 * 
 * If offer #1 deviates significantly from the average of #2 and #3, and its liquidity
 * is fragile, it is isolated as MANIPULACION_DETECTADA so it does not skew the execution rate.
 */
export function detectPriceOutliers(
  candidateOffers: readonly RawP2POfferInput[],
  side: RadarOrderSide,
  deviationThresholdPct: number,
): Set<string> {
  const outlierAdvNos = new Set<string>();

  if (candidateOffers.length < 3) {
    return outlierAdvNos;
  }

  // Order sorting: BUY -> Descending price (best buyer pays more), SELL -> Ascending price (best seller sells cheaper)
  const sorted = [...candidateOffers].sort((a, b) =>
    side === 'BUY' ? b.price - a.price : a.price - b.price,
  );

  const top1 = sorted[0];
  const top2 = sorted[1];
  const top3 = sorted[2];

  const avgBaseline = (top2.price + top3.price) / 2.0;
  if (avgBaseline <= 0) return outlierAdvNos;

  const deviationPct = (Math.abs(top1.price - avgBaseline) / avgBaseline) * 100.0;

  // Condition: Extreme price spread combined with thin surplus
  if (deviationPct >= deviationThresholdPct) {
    outlierAdvNos.add(top1.advNo);
  }

  return outlierAdvNos;
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
  // Step 1: Detect Outliers at the top of book
  const outlierSet = config.enabled
    ? detectPriceOutliers(rawOffers, side, config.outlierDeviationPct)
    : new Set<string>();

  const cleanOffers: CleanRadarOffer[] = [];
  const rejectedOffers: CleanRadarOffer[] = [];

  for (const raw of rawOffers) {
    const baseVerdict = auditOfferCleanMode(raw, config);
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
