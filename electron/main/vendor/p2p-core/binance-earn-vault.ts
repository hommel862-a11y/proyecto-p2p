/**
 * Binance Earn Vault & Passive Treasury Optimization Core Engine.
 * Implements 10 institutional quantitative models for passive yield,
 * liquidity laddering, dual investment exits, and P2P hurdle rate analysis.
 * 0 external framework dependencies. Pure deterministic functions.
 *
 * ABSENCE DOCTRINE (mirrors `audit-analytics.AssessmentStatus`)
 * ------------------------------------------------------------
 * An absent measurement is `null` plus a declared absence that names the
 * required source. It is never a number. `?? 500`, `|| 0` and
 * `Math.max(0.0001, x)` are not benign defaults: they are unsourced market
 * assertions. `Math.max` does not even guard absence — `Math.max(0.0001,
 * undefined)` is `NaN`, which poisons every downstream operation.
 *
 * Invariant enforced by the spec: `assessmentStatus === 'NOT_ASSESSED'` if
 * and only if at least one reported number is `null`.
 */

// ---------------------------------------------------------------------------
// Absence declaration primitives
// ---------------------------------------------------------------------------

/** Mirrors `AssessmentStatus` in `audit-analytics.ts`, kept local so this
 * engine stays dependency-free. */
export type MeasurementStatus = 'ASSESSED' | 'NOT_ASSESSED';

/** Whether an assessment had real data behind it. */
export interface MeasurementDeclaration {
  /** `NOT_ASSESSED` whenever any reported number is `null`. */
  assessmentStatus: MeasurementStatus;
  /** Input names that had no measurement. Empty when `ASSESSED`. */
  missingInputs: string[];
  /** Where the missing measurements must come from. Empty when `ASSESSED`. */
  expectedSource: string;
}

/** A value counts as measured only if it is a finite number. */
function isMeasured(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Rounds a measured value, collapsing absence to `null` instead of `NaN`. */
function round(value: number | null | undefined, decimals: number): number | null {
  return isMeasured(value) ? Number(value.toFixed(decimals)) : null;
}

/** Collects absent measurements and renders the declaration. */
class AbsentMeasurements {
  readonly names: string[] = [];
  private readonly sources: string[] = [];

  record(name: string, source: string): void {
    if (this.names.includes(name)) return;
    this.names.push(name);
    this.sources.push(`${name} → ${source}`);
  }

  get status(): MeasurementStatus {
    return this.names.length > 0 ? 'NOT_ASSESSED' : 'ASSESSED';
  }

  get expectedSource(): string {
    return this.sources.join(' · ');
  }

  /** Attaches the declaration to a result object. */
  declare<T extends object>(result: T): T & MeasurementDeclaration {
    return {
      ...result,
      assessmentStatus: this.status,
      missingInputs: [...this.names],
      expectedSource: this.expectedSource,
    };
  }
}

/** Reads a measurement, returning `null` and declaring its absence. */
function measured(
  value: number | null | undefined,
  name: string,
  source: string,
  absent: AbsentMeasurements,
): number | null {
  if (isMeasured(value)) return value;
  absent.record(name, source);
  return null;
}

/**
 * Reads a measurement that must additionally be positive (a denominator, a
 * base rate). A measured `0` or negative value cannot produce the ratio, so
 * it is declared absent rather than silently clamped.
 */
function measuredPositive(
  value: number | null | undefined,
  name: string,
  source: string,
  absent: AbsentMeasurements,
): number | null {
  if (isMeasured(value) && value > 0) return value;
  absent.record(name, source);
  return null;
}

// Required sources, named so an operator can actually go fetch the number.
const SRC_TIER_1_LIMIT =
  'límite Tier 1 por cuenta publicado por el venue (API pública de Binance Earn Flexible)';
const SRC_HOLDING_DAYS = 'período de tenencia planificado por el operador';
const SRC_SPOT_PRICE = 'precio spot en vivo del activo (API pública del exchange)';
const SRC_STRIKE_PRICE =
  'precio de ejercicio (strike) publicado por el venue para el producto Dual Investment';
const SRC_MARKET_RATE =
  'tasa de mercado USDT/FDUSD en vivo (API pública del exchange o libro de órdenes)';
const SRC_SWAP_FEE = 'comisión de swap USDT/FDUSD publicada por el venue';
const SRC_HORIZON_DAYS = 'horizonte de operación planificado por el operador';
const SRC_POOL_DURATION = 'duración del Launchpool publicada por el venue';
const SRC_PUBLISHED_APR =
  'APR anualizado publicado por el venue para el producto (API pública de Binance Earn)';
const SRC_TOTAL_POOL =
  'total realmente stakeado en el pool, publicado por el venue (API pública de Binance Launchpool)';
const SRC_LISTING_PRICE = 'precio de listado estimado del token';
const SRC_ALT_EARN_APR = 'tasa Alternative Earn publicada por el venue';
const SRC_SAFETY_BUFFER = 'política de colchón de seguridad declarada por la tesorería';
const SRC_TURNOVER_DAYS = 'días de rotación P2P observados en el libro';
const SRC_DAILY_VOLUME = 'volumen diario P2P en vivo (API pública de Binance P2P)';
const SRC_CYCLE_HOURS = 'horas promedio por ciclo de operación P2P, observadas en la cuenta';
const SRC_BNB_PRICE = 'precio de BNB en vivo (API pública del exchange)';
const SRC_AIRDROP_APR = 'tasa anual proyectada del airdrop Hodler, con su fuente declarada';
const SRC_TIER_1_LIMIT_PER_ACCOUNT =
  'límite Tier 1 por cuenta publicado por el venue (API pública de Binance Earn Flexible)';
const SRC_SUBACCOUNTS = 'cantidad de subcuentas realmente disponibles en la cuenta';
const SRC_ASSET_GROWTH = 'tasa de crecimiento anual proyectada del activo, con su fuente declarada';
const SRC_DAILY_QUOTA =
  'cuota diaria de rescate instantáneo publicada por el venue (API del exchange)';
const SRC_QUOTA_CONSUMED = 'cuota diaria ya consumida, leída de la cuenta';
const SRC_SETTLEMENT_DELAY = 'demora media de liquidación medida en la cuenta';
const SRC_SIMPLE_EARN_APR =
  'tasa vigente de Simple Earn por nivel de saldo, publicada por el venue (API de Binance Earn)';

export interface SimpleEarnOptimizationInput {
  capitalUsdt: number;
  tier1LimitUsdt?: number | null;
  tier1AprPct: number;
  tier2AprPct: number;
  holdingDays?: number | null;
}

export interface SimpleEarnOptimizationResult extends MeasurementDeclaration {
  capitalUsdt: number;
  tier1Allocated: number | null;
  tier2Allocated: number | null;
  effectiveBlendedAprPct: number | null;
  dailyYieldUsdt: number | null;
  monthlyYieldUsdt: number | null;
  /** `null` when `holdingDays` was not measured. */
  projectedPeriodYieldUsdt: number | null;
  opportunityCostPerHourUsdt: number | null;
}

export interface DualInvestmentInput {
  currentSpotPrice: number | null;
  strikePrice: number | null;
  durationDays: number | null;
  annualizedAprPct: number | null;
  investedCapitalUsdt: number;
}

export interface DualInvestmentResult extends MeasurementDeclaration {
  investedCapitalUsdt: number;
  strikePrice: number | null;
  durationDays: number | null;
  annualizedAprPct: number | null;
  periodYieldPct: number | null;
  periodInterestUsdt: number | null;
  outcomeIfExercised: {
    exercised: true;
    /** `null` when `strikePrice` was not measured. */
    totalCryptoReceived: number | null;
    effectiveExitPrice: number | null;
    /** `null` when spot or strike was not measured. */
    profitVsSpotPct: number | null;
  };
  outcomeIfNotExercised: {
    exercised: false;
    totalUsdtReturned: number | null;
    netReturnUsdt: number | null;
    annualizedRoiPct: number | null;
  };
  recommendation: 'SELL_HIGH_FAVORABLE' | 'HOLD_SPOT' | 'SPREAD_P2P_SUPERIOR' | 'NOT_ASSESSED';
}

export interface StablecoinYieldArbitrageInput {
  usdtBalance: number;
  fdusdBalance: number;
  usdtFlexibleAprPct: number;
  fdusdFlexibleAprPct: number;
  usdtFdusdMarketRate?: number | null;
  swapFeePct?: number | null;
  plannedHorizonDays?: number | null;
}

export interface StablecoinYieldArbitrageResult extends MeasurementDeclaration {
  currentUsdtYieldMonthly: number | null;
  currentFdusdYieldMonthly: number | null;
  rateSpreadPct: number | null;
  /** `null` when `usdtFdusdMarketRate` was not measured. */
  pegDeviationPct: number | null;
  optimalSwapDirection:
    | 'SWAP_USDT_TO_FDUSD'
    | 'SWAP_FDUSD_TO_USDT'
    | 'MAINTAIN_EQUILIBRIUM'
    | 'NOT_ASSESSED';
  /** `null` when the swap fee or the horizon was not measured. */
  breakevenDays: number | null;
  /** `null` when the swap fee or the horizon was not measured. */
  projectedNetAdvantageUsdt: number | null;
  summary: string;
}

export interface LaunchpoolParkingInput {
  capitalUsdt: number;
  stakedAsset: 'BNB' | 'FDUSD' | 'USDT';
  launchpoolDurationDays: number | null;
  totalPoolStaked: number | null;
  dailyRewardPoolTokens: number;
  estimatedTokenListingPriceUsdt: number | null;
  alternativeEarnAprPct?: number | null;
}

export interface LaunchpoolParkingResult extends MeasurementDeclaration {
  capitalUsdt: number;
  stakedAsset: string;
  userPoolSharePct: number | null;
  dailyTokensEarned: number | null;
  totalTokensProjected: number | null;
  totalProjectedValueUsdt: number | null;
  impliedAnnualizedAprPct: number | null;
  earnOpportunityCostUsdt: number | null;
  netExcessProfitUsdt: number | null;
  isFavorableOverEarn: boolean | null;
}

export interface LiquidityLadderInput {
  totalTreasuryUsdt: number;
  dailyP2pVolumeUsdt: number | null;
  p2pTurnoverDays: number | null;
  flexibleAprPct: number | null;
  locked30dAprPct: number;
  locked60dAprPct: number;
  safetyBufferPct?: number | null;
}

export interface LiquidityLadderResult extends MeasurementDeclaration {
  totalTreasuryUsdt: number;
  flexibleBufferUsdt: number | null;
  locked30dUsdt: number | null;
  locked60dUsdt: number | null;
  blendedPortfolioAprPct: number | null;
  projectedAnnualYieldUsdt: number | null;
  /** `null` when there is no positive daily volume to divide by. */
  liquidityCoverageRatio: number | null;
  weeklyRollingLiquidityUsdt: number | null;
}

export interface EarnHurdleRateInput {
  grossP2pSpreadPct: number;
  platformFeePct: number;
  bankingRiskPremiumPct: number;
  fxDevaluationRiskPct: number;
  averageTradeCycleHours: number | null;
  simpleEarnAprPct: number | null;
}

export interface EarnHurdleRateResult extends MeasurementDeclaration {
  netP2pCycleReturnPct: number | null;
  annualizedP2pRoiPct: number | null;
  hourlyP2pReturnPct: number | null;
  hourlyEarnYieldPct: number | null;
  hurdleSpreadPct: number | null;
  isP2pProfitableOverEarn: boolean | null;
  verdict:
    | 'OPERATE_P2P'
    | 'PARK_IN_EARN'
    | 'ARBITRAGE_CYCLE_SUBOPTIMAL'
    | 'NOT_ASSESSED';
  reasoning: string;
}

export interface BnbVaultInput {
  bnbAmount: number;
  bnbPriceUsdt: number | null;
  simpleEarnAprPct: number;
  activeLaunchpoolsCount: number;
  averageLaunchpoolAprPct: number;
  hodlerAirdropProjectedAprPct?: number | null;
}

export interface BnbVaultResult extends MeasurementDeclaration {
  bnbAmount: number;
  totalBnbValueUsdt: number | null;
  simpleEarnYieldBnb: number | null;
  launchpoolYieldUsdt: number | null;
  airdropYieldUsdt: number | null;
  stackedBlendedAprPct: number | null;
  totalAnnualProjectedYieldUsdt: number | null;
}

export interface TierSaturationInput {
  totalCapitalUsdt: number;
  tier1LimitPerAccountUsdt?: number | null;
  // These two are venue-published, so absence is a real possibility the caller
  // must be allowed to express. Leaving them `number` forced the old code to
  // treat a missing APR as `0%` rather than declaring it unmeasured.
  tier1AprPct?: number | null;
  tier2AprPct?: number | null;
  availableSubaccountsCount?: number | null;
}

export interface TierSaturationResult extends MeasurementDeclaration {
  totalCapitalUsdt: number;
  tier1UtilizedUsdt: number | null;
  tier2DegradedUsdt: number | null;
  singleAccountEffectiveAprPct: number | null;
  multiAccountOptimizedAprPct: number | null;
  potentialAnnualSurplusUsdt: number | null;
  recommendedSubaccountsNeeded: number | null;
}

export interface AutoInvestDcaInput {
  monthlyP2pNetProfitUsdt: number;
  reinvestmentRatioPct: number;
  targetAsset: 'BTC' | 'ETH' | 'BNB' | 'SOL';
  projectedAnnualAssetGrowthPct?: number | null;
  executionFrequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY';
}

export interface AutoInvestDcaResult extends MeasurementDeclaration {
  monthlyReinvestedUsdt: number | null;
  retainedTreasuryUsdt: number | null;
  periodicInvestmentUsdt: number | null;
  projectedYearlyAllocatedUsdt: number | null;
  /** `null` when `projectedAnnualAssetGrowthPct` was not measured. */
  projectedEndValueUsdt: number | null;
  workingCapitalPreservationPct: number | null;
}

export interface InstantRedemptionInput {
  redemptionAmountUsdt: number;
  dailyInstantQuotaUsdt?: number | null;
  dailyQuotaConsumedUsdt?: number | null;
  averageSlippageOrDelayHours?: number | null;
}

export interface InstantRedemptionResult extends MeasurementDeclaration {
  requestedAmountUsdt: number;
  instantRedemptionAvailableUsdt: number | null;
  canExecuteInstant: boolean | null;
  standardRedemptionPendingUsdt: number | null;
  estimatedSettlementDelayHours: number | null;
  executionRisk: 'NEGLIGIBLE' | 'PARTIAL_DELAY' | 'HIGH_LATENCY' | 'NOT_ASSESSED';
  actionablePlan: string;
}

// ---------------------------------------------------------------------------
// 1. Optimize Idle Capital Simple Earn
// ---------------------------------------------------------------------------
export function optimizeIdleCapitalSimpleEarn(
  input: SimpleEarnOptimizationInput,
): SimpleEarnOptimizationResult {
  const absent = new AbsentMeasurements();
  const capital = Math.max(0, input.capitalUsdt);
  const tier1Limit = measured(input.tier1LimitUsdt, 'tier1LimitUsdt', SRC_TIER_1_LIMIT, absent);
  const t1Apr = Math.max(0, input.tier1AprPct) / 100;
  const t2Apr = Math.max(0, input.tier2AprPct) / 100;
  const days = measuredPositive(
    input.holdingDays,
    'holdingDays',
    SRC_HOLDING_DAYS,
    absent,
  );

  const tier1Allocated = tier1Limit === null ? null : Math.min(capital, tier1Limit);
  const tier2Allocated = tier1Limit === null ? null : Math.max(0, capital - tier1Limit);

  const totalAnnualYield =
    tier1Allocated === null || tier2Allocated === null
      ? null
      : tier1Allocated * t1Apr + tier2Allocated * t2Apr;

  // A measured zero capital yields a measured zero APR: there is no missing
  // input here, the portfolio is genuinely empty.
  const effectiveBlendedAprPct =
    totalAnnualYield === null ? null : capital > 0 ? (totalAnnualYield / capital) * 100 : 0;
  const dailyYieldUsdt = totalAnnualYield === null ? null : totalAnnualYield / 365;
  const monthlyYieldUsdt = totalAnnualYield === null ? null : (totalAnnualYield / 365) * 30;
  const projectedPeriodYieldUsdt =
    totalAnnualYield === null || days === null ? null : (totalAnnualYield / 365) * days;
  const opportunityCostPerHourUsdt =
    dailyYieldUsdt === null ? null : dailyYieldUsdt / 24;

  return absent.declare({
    capitalUsdt: capital,
    tier1Allocated: round(tier1Allocated, 2),
    tier2Allocated: round(tier2Allocated, 2),
    effectiveBlendedAprPct: round(effectiveBlendedAprPct, 2),
    dailyYieldUsdt: round(dailyYieldUsdt, 4),
    monthlyYieldUsdt: round(monthlyYieldUsdt, 2),
    projectedPeriodYieldUsdt: round(projectedPeriodYieldUsdt, 2),
    opportunityCostPerHourUsdt: round(opportunityCostPerHourUsdt, 5),
  });
}

// ---------------------------------------------------------------------------
// 2. Evaluate Dual Investment P2P Exit
// ---------------------------------------------------------------------------
export function evaluateDualInvestmentP2pExit(input: DualInvestmentInput): DualInvestmentResult {
  const absent = new AbsentMeasurements();
  // `Math.max(0.0001, spot)` did not guard absence: with an absent price it
  // produced NaN, and with a genuine sub-cent price it silently fabricated a
  // floor. A measurement is either taken as-is or declared absent.
  const spot = measured(input.currentSpotPrice, 'currentSpotPrice', SRC_SPOT_PRICE, absent);
  const strike = measuredPositive(input.strikePrice, 'strikePrice', SRC_STRIKE_PRICE, absent);
  const days = measuredPositive(input.durationDays, 'durationDays', SRC_POOL_DURATION, absent);
  const apr = measured(input.annualizedAprPct, 'annualizedAprPct', SRC_PUBLISHED_APR, absent);
  const capital = Math.max(0, input.investedCapitalUsdt);

  const periodYieldPct = days === null || apr === null ? null : (apr * days) / 365;
  const periodInterestUsdt =
    periodYieldPct === null ? null : capital * periodYieldPct;

  const totalUsdtReturned =
    periodInterestUsdt === null ? null : capital + periodInterestUsdt;
  const annualizedRoiPct =
    periodInterestUsdt === null || days === null || capital <= 0
      ? null
      : (periodInterestUsdt / capital) * (365 / days) * 100;

  const totalCryptoReceived =
    strike === null || totalUsdtReturned === null ? null : totalUsdtReturned / strike;
  const effectiveExitPrice = strike;
  const profitVsSpotPct =
    spot === null || strike === null || periodYieldPct === null
      ? null
      : ((strike - spot) / spot) * 100 + periodYieldPct * 100;

  let recommendation: DualInvestmentResult['recommendation'];
  if (spot === null || strike === null || annualizedRoiPct === null) {
    // No verdict without both legs: the old code decided "SELL_HIGH_FAVORABLE"
    // or "SPREAD_P2P_SUPERIOR" from a price it had invented.
    recommendation = 'NOT_ASSESSED';
  } else if (strike > spot && annualizedRoiPct > 15) {
    recommendation = 'SELL_HIGH_FAVORABLE';
  } else if (strike <= spot) {
    recommendation = 'SPREAD_P2P_SUPERIOR';
  } else {
    recommendation = 'HOLD_SPOT';
  }

  return absent.declare({
    investedCapitalUsdt: capital,
    strikePrice: strike,
    durationDays: days,
    annualizedAprPct: input.annualizedAprPct,
    periodYieldPct: round(periodYieldPct === null ? null : periodYieldPct * 100, 3),
    periodInterestUsdt: round(periodInterestUsdt, 2),
    outcomeIfExercised: {
      exercised: true,
      totalCryptoReceived: round(totalCryptoReceived, 6),
      effectiveExitPrice,
      profitVsSpotPct: round(profitVsSpotPct, 2),
    },
    outcomeIfNotExercised: {
      exercised: false,
      totalUsdtReturned: round(totalUsdtReturned, 2),
      netReturnUsdt: round(periodInterestUsdt, 2),
      annualizedRoiPct: round(annualizedRoiPct, 2),
    },
    recommendation,
  });
}

// ---------------------------------------------------------------------------
// 3. Calculate USDT / FDUSD Yield Arbitrage
// ---------------------------------------------------------------------------
export function calculateUsdtFdusdYieldArbitrage(
  input: StablecoinYieldArbitrageInput,
): StablecoinYieldArbitrageResult {
  const absent = new AbsentMeasurements();
  const usdtBal = Math.max(0, input.usdtBalance);
  const fdusdBal = Math.max(0, input.fdusdBalance);
  const usdtApr = Math.max(0, input.usdtFlexibleAprPct) / 100;
  const fdusdApr = Math.max(0, input.fdusdFlexibleAprPct) / 100;
  // The worst default in this module: with an absent rate the old code read a
  // perfect peg (0.000% deviation), satisfied `rate <= 1.0005` and emitted an
  // operational SWAP order on the operator's real money.
  const marketRate = measured(
    input.usdtFdusdMarketRate,
    'usdtFdusdMarketRate',
    SRC_MARKET_RATE,
    absent,
  );
  const swapFee = measured(input.swapFeePct, 'swapFeePct', SRC_SWAP_FEE, absent);
  const horizon = measuredPositive(
    input.plannedHorizonDays,
    'plannedHorizonDays',
    SRC_HORIZON_DAYS,
    absent,
  );

  const currentUsdtYieldMonthly = (usdtBal * usdtApr * 30) / 365;
  const currentFdusdYieldMonthly = (fdusdBal * fdusdApr * 30) / 365;

  const rateSpreadPct = (fdusdApr - usdtApr) * 100;
  const pegDeviationPct = marketRate === null ? null : ((marketRate - 1.0) / 1.0) * 100;

  let optimalSwapDirection: StablecoinYieldArbitrageResult['optimalSwapDirection'];
  let breakevenDays: number | null = null;
  let projectedNetAdvantageUsdt: number | null = null;

  if (marketRate === null) {
    // No measured rate, no trade recommendation.
    optimalSwapDirection = 'NOT_ASSESSED';
  } else if (fdusdApr > usdtApr + 0.015 && marketRate <= 1.0005) {
    optimalSwapDirection = 'SWAP_USDT_TO_FDUSD';
    const netAprAdvantage = fdusdApr - usdtApr;
    // Breakeven depends on the fee only; the horizon is irrelevant to it.
    breakevenDays = swapFee === null ? null : swapFee / 100 / (netAprAdvantage / 365);
    projectedNetAdvantageUsdt =
      swapFee === null || horizon === null
        ? null
        : usdtBal * ((netAprAdvantage * horizon) / 365) - usdtBal * (swapFee / 100);
  } else if (usdtApr > fdusdApr + 0.015 && marketRate >= 0.9995) {
    optimalSwapDirection = 'SWAP_FDUSD_TO_USDT';
    const netAprAdvantage = usdtApr - fdusdApr;
    breakevenDays = swapFee === null ? null : swapFee / 100 / (netAprAdvantage / 365);
    projectedNetAdvantageUsdt =
      swapFee === null || horizon === null
        ? null
        : fdusdBal * ((netAprAdvantage * horizon) / 365) - fdusdBal * (swapFee / 100);
  } else {
    optimalSwapDirection = 'MAINTAIN_EQUILIBRIUM';
    breakevenDays = 0;
    projectedNetAdvantageUsdt = 0;
  }

  // The summary must never claim a peg deviation that was not measured.
  const summary =
    pegDeviationPct === null
      ? `Arbitraje USDT/FDUSD: Spread APR ${rateSpreadPct.toFixed(2)}%. ` +
        'Dirección NO EVALUADA: falta la tasa de mercado USDT/FDUSD en vivo ' +
        '(requerida: usdtFdusdMarketRate → tasa de mercado en vivo del exchange). ' +
        'No se emite recomendación de swap sin una medición del peg.'
      : `Arbitraje USDT/FDUSD: Spread APR ${rateSpreadPct.toFixed(2)}%, Desvío Peg ${pegDeviationPct.toFixed(3)}%. Dirección: ${optimalSwapDirection}.`;

  return absent.declare({
    currentUsdtYieldMonthly: round(currentUsdtYieldMonthly, 2),
    currentFdusdYieldMonthly: round(currentFdusdYieldMonthly, 2),
    rateSpreadPct: round(rateSpreadPct, 2),
    pegDeviationPct: round(pegDeviationPct, 3),
    optimalSwapDirection,
    breakevenDays: round(breakevenDays, 1),
    projectedNetAdvantageUsdt: round(projectedNetAdvantageUsdt, 2),
    summary,
  });
}

// ---------------------------------------------------------------------------
// 4. Model Launchpool Capital Parking
// ---------------------------------------------------------------------------
export function modelLaunchpoolCapitalParking(
  input: LaunchpoolParkingInput,
): LaunchpoolParkingResult {
  const absent = new AbsentMeasurements();
  const capital = Math.max(0, input.capitalUsdt);
  const duration = measuredPositive(
    input.launchpoolDurationDays,
    'launchpoolDurationDays',
    SRC_POOL_DURATION,
    absent,
  );
  const totalPool = measuredPositive(
    input.totalPoolStaked,
    'totalPoolStaked',
    SRC_TOTAL_POOL,
    absent,
  );
  const dailyPoolTokens = Math.max(0, input.dailyRewardPoolTokens);
  const tokenPrice = measuredPositive(
    input.estimatedTokenListingPriceUsdt,
    'estimatedTokenListingPriceUsdt',
    SRC_LISTING_PRICE,
    absent,
  );
  const earnAprPct = measured(
    input.alternativeEarnAprPct,
    'alternativeEarnAprPct',
    SRC_ALT_EARN_APR,
    absent,
  );
  const earnApr = earnAprPct === null ? null : earnAprPct / 100;

  const userPoolSharePct =
    totalPool === null ? null : (capital / totalPool) * 100;
  const dailyTokensEarned =
    totalPool === null ? null : (dailyPoolTokens * capital) / totalPool;
  const totalTokensProjected =
    dailyTokensEarned === null || duration === null ? null : dailyTokensEarned * duration;
  const totalProjectedValueUsdt =
    totalTokensProjected === null || tokenPrice === null ? null : totalTokensProjected * tokenPrice;

  const impliedAnnualizedAprPct =
    totalProjectedValueUsdt === null || duration === null || capital <= 0
      ? null
      : (totalProjectedValueUsdt / capital) * (365 / duration) * 100;

  const earnOpportunityCostUsdt =
    earnApr === null || duration === null ? null : (capital * earnApr * duration) / 365;
  const netExcessProfitUsdt =
    totalProjectedValueUsdt === null || earnOpportunityCostUsdt === null
      ? null
      : totalProjectedValueUsdt - earnOpportunityCostUsdt;
  const isFavorableOverEarn = netExcessProfitUsdt === null ? null : netExcessProfitUsdt > 0;

  return absent.declare({
    capitalUsdt: capital,
    stakedAsset: input.stakedAsset,
    userPoolSharePct: round(userPoolSharePct, 6),
    dailyTokensEarned: round(dailyTokensEarned, 4),
    totalTokensProjected: round(totalTokensProjected, 2),
    totalProjectedValueUsdt: round(totalProjectedValueUsdt, 2),
    impliedAnnualizedAprPct: round(impliedAnnualizedAprPct, 2),
    earnOpportunityCostUsdt: round(earnOpportunityCostUsdt, 2),
    netExcessProfitUsdt: round(netExcessProfitUsdt, 2),
    isFavorableOverEarn,
  });
}

// ---------------------------------------------------------------------------
// 5. Optimize Locked vs Flexible Liquidity Ladder
// ---------------------------------------------------------------------------
export function optimizeLockedVsFlexibleLiquidityLadder(
  input: LiquidityLadderInput,
): LiquidityLadderResult {
  const absent = new AbsentMeasurements();
  const totalTreasury = Math.max(0, input.totalTreasuryUsdt);
  const dailyVolume = measuredPositive(
    input.dailyP2pVolumeUsdt,
    'dailyP2pVolumeUsdt',
    SRC_DAILY_VOLUME,
    absent,
  );
  const turnoverDays = measuredPositive(
    input.p2pTurnoverDays,
    'p2pTurnoverDays',
    SRC_TURNOVER_DAYS,
    absent,
  );
  const bufferPct = measured(
    input.safetyBufferPct,
    'safetyBufferPct',
    SRC_SAFETY_BUFFER,
    absent,
  );

  // Without a volume there is no operational buffer to size and no coverage
  // ratio to divide by; the old ternary answered "10.0 days of cover".
  const requiredOperationalBuffer =
    dailyVolume === null || turnoverDays === null || bufferPct === null
      ? null
      : Math.min(totalTreasury, dailyVolume * turnoverDays * (1 + bufferPct / 100));

  const flexibleBufferUsdt =
    requiredOperationalBuffer === null
      ? null
      : Math.max(totalTreasury * 0.35, requiredOperationalBuffer);
  const remainingForLocked =
    flexibleBufferUsdt === null ? null : Math.max(0, totalTreasury - flexibleBufferUsdt);

  const locked30dUsdt = remainingForLocked === null ? null : remainingForLocked * 0.65;
  const locked60dUsdt = remainingForLocked === null ? null : remainingForLocked * 0.35;

  // The capital split is a treasury policy decision and needs no APR, but the
  // blended return does. Keeping them independent means an absent APR nulls the
  // return without erasing the allocation.
  const flexAprValue = measured(
    input.flexibleAprPct,
    'flexibleAprPct',
    SRC_SIMPLE_EARN_APR,
    absent,
  );
  const flexApr = flexAprValue === null ? null : flexAprValue / 100;
  const l30Apr = input.locked30dAprPct / 100;
  const l60Apr = input.locked60dAprPct / 100;

  const totalAnnualYield =
    flexApr === null || flexibleBufferUsdt === null || locked30dUsdt === null || locked60dUsdt === null
      ? null
      : flexibleBufferUsdt * flexApr + locked30dUsdt * l30Apr + locked60dUsdt * l60Apr;

  const blendedPortfolioAprPct =
    totalAnnualYield === null || totalTreasury <= 0 ? null : (totalAnnualYield / totalTreasury) * 100;
  const liquidityCoverageRatio =
    flexibleBufferUsdt === null || dailyVolume === null || dailyVolume <= 0
      ? null
      : flexibleBufferUsdt / dailyVolume;
  const weeklyRollingLiquidityUsdt =
    flexibleBufferUsdt === null || locked30dUsdt === null
      ? null
      : flexibleBufferUsdt + locked30dUsdt / 4;

  return absent.declare({
    totalTreasuryUsdt: totalTreasury,
    flexibleBufferUsdt: round(flexibleBufferUsdt, 2),
    locked30dUsdt: round(locked30dUsdt, 2),
    locked60dUsdt: round(locked60dUsdt, 2),
    blendedPortfolioAprPct: round(blendedPortfolioAprPct, 2),
    projectedAnnualYieldUsdt: round(totalAnnualYield, 2),
    liquidityCoverageRatio: round(liquidityCoverageRatio, 2),
    weeklyRollingLiquidityUsdt: round(weeklyRollingLiquidityUsdt, 2),
  });
}

// ---------------------------------------------------------------------------
// 6. Calculate Earn Yield vs P2P Hurdle Rate
// ---------------------------------------------------------------------------
export function calculateEarnYieldVsP2pHurdleRate(
  input: EarnHurdleRateInput,
): EarnHurdleRateResult {
  const absent = new AbsentMeasurements();
  const grossSpread = Math.max(0, input.grossP2pSpreadPct);
  const platformFee = Math.max(0, input.platformFeePct);
  const bankingRisk = Math.max(0, input.bankingRiskPremiumPct);
  const fxRisk = Math.max(0, input.fxDevaluationRiskPct);
  // `Math.max(0.5, cycleHours)` guarded the division by zero only for a
  // measured value; an absent cycle length produced NaN and a NaN verdict.
  const cycleHours = measuredPositive(
    input.averageTradeCycleHours,
    'averageTradeCycleHours',
    SRC_CYCLE_HOURS,
    absent,
  );
  const earnAprValue = measured(
    input.simpleEarnAprPct,
    'simpleEarnAprPct',
    SRC_SIMPLE_EARN_APR,
    absent,
  );
  const earnApr = earnAprValue === null ? null : Math.max(0, earnAprValue) / 100;

  const netP2pCycleReturnPct = grossSpread - platformFee - bankingRisk - fxRisk;
  const cyclesPerYear = cycleHours === null ? null : (365 * 24) / cycleHours;
  const annualizedP2pRoiPct =
    cyclesPerYear === null ? null : netP2pCycleReturnPct * cyclesPerYear;

  const hourlyP2pReturnPct = cycleHours === null ? null : netP2pCycleReturnPct / cycleHours;
  const hourlyEarnYieldPct = earnApr === null ? null : (earnApr / (365 * 24)) * 100;

  const hurdleSpreadPct =
    hourlyEarnYieldPct === null
      ? null
      : platformFee + bankingRisk + fxRisk + hourlyEarnYieldPct * 24;
  const isP2pProfitableOverEarn =
    hourlyP2pReturnPct === null || hourlyEarnYieldPct === null
      ? null
      : hourlyP2pReturnPct > hourlyEarnYieldPct && netP2pCycleReturnPct > 0.35;

  let verdict: EarnHurdleRateResult['verdict'];
  let reasoning: string;

  if (cycleHours === null || hourlyEarnYieldPct === null) {
    verdict = 'NOT_ASSESSED';
    reasoning =
      'No se emite veredicto: falta la duración media del ciclo de operación P2P ' +
      '(averageTradeCycleHours) o la tasa vigente de Simple Earn (simpleEarnAprPct). ' +
      'Comparar P2P contra Earn exige ambas mediciones.';
  } else if (isP2pProfitableOverEarn && netP2pCycleReturnPct >= 0.5) {
    verdict = 'OPERATE_P2P';
    reasoning = `El spread neto P2P (${netP2pCycleReturnPct.toFixed(2)}%) supera ampliamente la tasa libre de riesgo de Earn (${(hourlyEarnYieldPct * cycleHours).toFixed(4)}% por ciclo). Proceder con rotación P2P Maker.`;
  } else if (netP2pCycleReturnPct <= 0 || hourlyP2pReturnPct! < hourlyEarnYieldPct) {
    verdict = 'PARK_IN_EARN';
    reasoning = `Riesgo cambiario y comisiones devoran el spread. El rendimiento libre de riesgo en Binance Simple Earn ofrece mayor retorno ajustado por riesgo. Recomendar estacionar capital en Simple Earn.`;
  } else {
    verdict = 'ARBITRAGE_CYCLE_SUBOPTIMAL';
    reasoning = `El spread P2P (${netP2pCycleReturnPct.toFixed(2)}%) es positivo pero marginal frente a la fricción operativa y bancaria. Mantener postura defensiva.`;
  }

  return absent.declare({
    netP2pCycleReturnPct: round(netP2pCycleReturnPct, 3),
    annualizedP2pRoiPct: round(annualizedP2pRoiPct, 1),
    hourlyP2pReturnPct: round(hourlyP2pReturnPct, 4),
    hourlyEarnYieldPct: round(hourlyEarnYieldPct, 6),
    // The cycle length cancels out of the hurdle spread, so this stays measured.
    hurdleSpreadPct: round(hurdleSpreadPct, 3),
    isP2pProfitableOverEarn,
    verdict,
    reasoning,
  });
}

// ---------------------------------------------------------------------------
// 7. Model BNB Vault Yield Stacking
// ---------------------------------------------------------------------------
export function modelBnbVaultYieldStacking(input: BnbVaultInput): BnbVaultResult {
  const absent = new AbsentMeasurements();
  const bnbAmount = Math.max(0, input.bnbAmount);
  const bnbPrice = measuredPositive(input.bnbPriceUsdt, 'bnbPriceUsdt', SRC_BNB_PRICE, absent);
  const totalBnbValueUsdt = bnbPrice === null ? null : bnbAmount * bnbPrice;

  const earnApr = Math.max(0, input.simpleEarnAprPct) / 100;
  const launchpools = Math.max(0, input.activeLaunchpoolsCount);
  const avgLaunchpoolApr = (Math.max(0, input.averageLaunchpoolAprPct) / 100) * launchpools;
  const airdropAprPct = measured(
    input.hodlerAirdropProjectedAprPct,
    'hodlerAirdropProjectedAprPct',
    SRC_AIRDROP_APR,
    absent,
  );
  const airdropApr = airdropAprPct === null ? null : airdropAprPct / 100;

  // Simple Earn accrues in BNB, so it needs no USDT price.
  const simpleEarnYieldBnb = bnbAmount * earnApr;
  const launchpoolYieldUsdt =
    totalBnbValueUsdt === null ? null : totalBnbValueUsdt * avgLaunchpoolApr;
  const airdropYieldUsdt =
    totalBnbValueUsdt === null || airdropApr === null
      ? null
      : totalBnbValueUsdt * airdropApr;

  const stackedBlendedAprPct =
    airdropApr === null ? null : (earnApr + avgLaunchpoolApr + airdropApr) * 100;
  const totalAnnualProjectedYieldUsdt =
    launchpoolYieldUsdt === null ||
    airdropYieldUsdt === null ||
    bnbPrice === null
      ? null
      : simpleEarnYieldBnb * bnbPrice + launchpoolYieldUsdt + airdropYieldUsdt;

  return absent.declare({
    bnbAmount,
    totalBnbValueUsdt: round(totalBnbValueUsdt, 2),
    simpleEarnYieldBnb: round(simpleEarnYieldBnb, 4),
    launchpoolYieldUsdt: round(launchpoolYieldUsdt, 2),
    airdropYieldUsdt: round(airdropYieldUsdt, 2),
    stackedBlendedAprPct: round(stackedBlendedAprPct, 2),
    totalAnnualProjectedYieldUsdt: round(totalAnnualProjectedYieldUsdt, 2),
  });
}

// ---------------------------------------------------------------------------
// 8. Forecast Flexible Earn Tier Saturation
// ---------------------------------------------------------------------------
export function forecastFlexibleEarnTierSaturation(
  input: TierSaturationInput,
): TierSaturationResult {
  const absent = new AbsentMeasurements();
  const totalCapital = Math.max(0, input.totalCapitalUsdt);
  // `measuredPositive` here was a false absence, not a guard. A Tier-1 limit of
  // 0 and a subaccount count of 0 are real, actionable facts ("this account has
  // no Tier-1 capacity"), and neither is a denominator — both only feed
  // min/max/multiply. Reporting "unknown" there hides the product limitation.
  const tier1Limit = measured(
    input.tier1LimitPerAccountUsdt,
    'tier1LimitPerAccountUsdt',
    SRC_TIER_1_LIMIT_PER_ACCOUNT,
    absent,
  );
  // `Math.max(0, input.tier1AprPct)` turned an absent APR into a real 0%, which
  // understates yield and can flip a recommendation. Both legs are measured.
  const t1AprPct = measured(input.tier1AprPct, 'tier1AprPct', SRC_PUBLISHED_APR, absent);
  const t2AprPct = measured(input.tier2AprPct, 'tier2AprPct', SRC_PUBLISHED_APR, absent);
  const availableSubaccounts = measured(
    input.availableSubaccountsCount,
    'availableSubaccountsCount',
    SRC_SUBACCOUNTS,
    absent,
  );
  const t1Apr = t1AprPct === null ? null : t1AprPct / 100;
  const t2Apr = t2AprPct === null ? null : t2AprPct / 100;

  const tier1UtilizedUsdt =
    tier1Limit === null ? null : Math.min(totalCapital, tier1Limit);
  const tier2DegradedUsdt =
    tier1Limit === null ? null : Math.max(0, totalCapital - tier1Limit);

  const singleAccountAnnualYield =
    tier1UtilizedUsdt === null || tier2DegradedUsdt === null || t1Apr === null || t2Apr === null
      ? null
      : tier1UtilizedUsdt * t1Apr + tier2DegradedUsdt * t2Apr;
  const singleAccountEffectiveAprPct =
    singleAccountAnnualYield === null || totalCapital <= 0
      ? null
      : (singleAccountAnnualYield / totalCapital) * 100;

  const multiAccountTier1Capacity =
    tier1Limit === null || availableSubaccounts === null
      ? null
      : tier1Limit * availableSubaccounts;
  const multiTier1Allocated =
    multiAccountTier1Capacity === null
      ? null
      : Math.min(totalCapital, multiAccountTier1Capacity);
  const multiTier2Allocated =
    multiAccountTier1Capacity === null
      ? null
      : Math.max(0, totalCapital - multiAccountTier1Capacity);

  const multiAccountAnnualYield =
    multiTier1Allocated === null || multiTier2Allocated === null || t1Apr === null || t2Apr === null
      ? null
      : multiTier1Allocated * t1Apr + multiTier2Allocated * t2Apr;
  const multiAccountOptimizedAprPct =
    multiAccountAnnualYield === null || totalCapital <= 0
      ? null
      : (multiAccountAnnualYield / totalCapital) * 100;

  const potentialAnnualSurplusUsdt =
    multiAccountAnnualYield === null || singleAccountAnnualYield === null
      ? null
      : multiAccountAnnualYield - singleAccountAnnualYield;
  const recommendedSubaccountsNeeded =
    tier1Limit === null || tier1Limit <= 0 ? null : Math.ceil(totalCapital / tier1Limit);

  return absent.declare({
    totalCapitalUsdt: totalCapital,
    tier1UtilizedUsdt: round(tier1UtilizedUsdt, 2),
    tier2DegradedUsdt: round(tier2DegradedUsdt, 2),
    singleAccountEffectiveAprPct: round(singleAccountEffectiveAprPct, 2),
    multiAccountOptimizedAprPct: round(multiAccountOptimizedAprPct, 2),
    potentialAnnualSurplusUsdt: round(potentialAnnualSurplusUsdt, 2),
    recommendedSubaccountsNeeded,
  });
}

// ---------------------------------------------------------------------------
// 9. Calculate Auto-Invest DCA Spread Funnel
// ---------------------------------------------------------------------------
export function calculateAutoInvestDcaSpreadFunnel(input: AutoInvestDcaInput): AutoInvestDcaResult {
  const absent = new AbsentMeasurements();
  const monthlyProfit = Math.max(0, input.monthlyP2pNetProfitUsdt);
  const ratio = Math.min(100, Math.max(0, input.reinvestmentRatioPct)) / 100;
  const assetGrowthPct = measured(
    input.projectedAnnualAssetGrowthPct,
    'projectedAnnualAssetGrowthPct',
    SRC_ASSET_GROWTH,
    absent,
  );
  const assetGrowth = assetGrowthPct === null ? null : assetGrowthPct / 100;

  const monthlyReinvestedUsdt = monthlyProfit * ratio;
  const retainedTreasuryUsdt = monthlyProfit - monthlyReinvestedUsdt;

  let periodicInvestmentUsdt: number;
  if (input.executionFrequency === 'DAILY') {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 30;
  } else if (input.executionFrequency === 'WEEKLY') {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 4;
  } else {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 2;
  }

  const projectedYearlyAllocatedUsdt = monthlyReinvestedUsdt * 12;
  const projectedEndValueUsdt =
    assetGrowth === null ? null : projectedYearlyAllocatedUsdt * (1 + assetGrowth / 2);
  const workingCapitalPreservationPct = 100 - input.reinvestmentRatioPct;

  return absent.declare({
    monthlyReinvestedUsdt: round(monthlyReinvestedUsdt, 2),
    retainedTreasuryUsdt: round(retainedTreasuryUsdt, 2),
    periodicInvestmentUsdt: round(periodicInvestmentUsdt, 2),
    projectedYearlyAllocatedUsdt: round(projectedYearlyAllocatedUsdt, 2),
    projectedEndValueUsdt: round(projectedEndValueUsdt, 2),
    workingCapitalPreservationPct: round(workingCapitalPreservationPct, 1),
  });
}

// ---------------------------------------------------------------------------
// 10. Simulate Earn Instant Redemption Latency
// ---------------------------------------------------------------------------
export function simulateEarnInstantRedemptionLatency(
  input: InstantRedemptionInput,
): InstantRedemptionResult {
  const absent = new AbsentMeasurements();
  const requested = Math.max(0, input.redemptionAmountUsdt);
  // The old `?? 1000000` was an authorization, not a default: it told the
  // operator an instant redemption was approved at 100% for a quota nobody
  // had measured.
  // A quota of 0 is a real answer — "instant redemption is not enabled for this
  // account" — and consumed=0 means "nothing redeemed today". Neither is a
  // denominator here, so `measuredPositive` would have hidden both behind
  // NOT_ASSESSED and left the operator with no actionable truth.
  const dailyQuota = measured(
    input.dailyInstantQuotaUsdt,
    'dailyInstantQuotaUsdt',
    SRC_DAILY_QUOTA,
    absent,
  );
  const quotaConsumed = measured(
    input.dailyQuotaConsumedUsdt,
    'dailyQuotaConsumedUsdt',
    SRC_QUOTA_CONSUMED,
    absent,
  );
  const delayHours = measuredPositive(
    input.averageSlippageOrDelayHours,
    'averageSlippageOrDelayHours',
    SRC_SETTLEMENT_DELAY,
    absent,
  );

  const availableQuota =
    dailyQuota === null || quotaConsumed === null ? null : Math.max(0, dailyQuota - quotaConsumed);
  const canExecuteInstant =
    availableQuota === null ? null : requested <= availableQuota;

  const instantRedemptionAvailableUsdt =
    availableQuota === null ? null : Math.min(requested, availableQuota);
  const standardRedemptionPendingUsdt =
    availableQuota === null ? null : Math.max(0, requested - availableQuota);

  let executionRisk: InstantRedemptionResult['executionRisk'];
  let actionablePlan: string;

  if (canExecuteInstant === null) {
    executionRisk = 'NOT_ASSESSED';
    actionablePlan =
      'No se autoriza el rescate instantáneo: falta la cuota diaria real ' +
      '(requerida: dailyInstantQuotaUsdt → cuota publicada por el exchange, ' +
      'dailyQuotaConsumedUsdt → consumo leído de la cuenta). Sin esa medición no ' +
      'se afirma disponibilidad ni demora de liquidación.';
  } else if (canExecuteInstant) {
    executionRisk = 'NEGLIGIBLE';
    actionablePlan =
      'Rescate instantáneo aprobado al 100%. Fondos acreditados inmediatamente a Billetera Spot sin demora para atender la orden P2P.';
  } else if (instantRedemptionAvailableUsdt! > 0) {
    executionRisk = 'PARTIAL_DELAY';
    actionablePlan = `Cuota diaria superada parcialmente. Rescatar ${instantRedemptionAvailableUsdt!.toFixed(2)} USDT de forma inmediata y solicitar el excedente (${standardRedemptionPendingUsdt!.toFixed(2)} USDT) mediante Standard Redemption (D+1 00:00 UTC).`;
  } else {
    executionRisk = 'HIGH_LATENCY';
    actionablePlan =
      'Cuota diaria de rescate instantáneo agotada. Retiro diferido a D+1. Suspender colocación de órdenes Maker hasta reposición de liquidez.';
  }

  const estimatedSettlementDelayHours = canExecuteInstant ? 0 : delayHours;

  return absent.declare({
    requestedAmountUsdt: requested,
    instantRedemptionAvailableUsdt: round(instantRedemptionAvailableUsdt, 2),
    canExecuteInstant,
    standardRedemptionPendingUsdt: round(standardRedemptionPendingUsdt, 2),
    estimatedSettlementDelayHours: round(estimatedSettlementDelayHours, 2),
    executionRisk,
    actionablePlan,
  });
}
