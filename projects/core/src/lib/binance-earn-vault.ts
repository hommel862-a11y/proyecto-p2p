/**
 * Binance Earn Vault & Passive Treasury Optimization Core Engine.
 * Implements 10 institutional quantitative models for passive yield,
 * liquidity laddering, dual investment exits, and P2P hurdle rate analysis.
 * 0 external framework dependencies. Pure deterministic functions.
 */

export interface SimpleEarnOptimizationInput {
  capitalUsdt: number;
  tier1LimitUsdt?: number;
  tier1AprPct: number;
  tier2AprPct: number;
  holdingDays?: number;
}

export interface SimpleEarnOptimizationResult {
  capitalUsdt: number;
  tier1Allocated: number;
  tier2Allocated: number;
  effectiveBlendedAprPct: number;
  dailyYieldUsdt: number;
  monthlyYieldUsdt: number;
  projectedPeriodYieldUsdt: number;
  opportunityCostPerHourUsdt: number;
}

export interface DualInvestmentInput {
  currentSpotPrice: number;
  strikePrice: number;
  durationDays: number;
  annualizedAprPct: number;
  investedCapitalUsdt: number;
}

export interface DualInvestmentResult {
  investedCapitalUsdt: number;
  strikePrice: number;
  durationDays: number;
  annualizedAprPct: number;
  periodYieldPct: number;
  periodInterestUsdt: number;
  outcomeIfExercised: {
    exercised: true;
    totalCryptoReceived: number;
    effectiveExitPrice: number;
    profitVsSpotPct: number;
  };
  outcomeIfNotExercised: {
    exercised: false;
    totalUsdtReturned: number;
    netReturnUsdt: number;
    annualizedRoiPct: number;
  };
  recommendation: 'SELL_HIGH_FAVORABLE' | 'HOLD_SPOT' | 'SPREAD_P2P_SUPERIOR';
}

export interface StablecoinYieldArbitrageInput {
  usdtBalance: number;
  fdusdBalance: number;
  usdtFlexibleAprPct: number;
  fdusdFlexibleAprPct: number;
  usdtFdusdMarketRate?: number;
  swapFeePct?: number;
  plannedHorizonDays?: number;
}

export interface StablecoinYieldArbitrageResult {
  currentUsdtYieldMonthly: number;
  currentFdusdYieldMonthly: number;
  rateSpreadPct: number;
  pegDeviationPct: number;
  optimalSwapDirection: 'SWAP_USDT_TO_FDUSD' | 'SWAP_FDUSD_TO_USDT' | 'MAINTAIN_EQUILIBRIUM';
  breakevenDays: number;
  projectedNetAdvantageUsdt: number;
  summary: string;
}

export interface LaunchpoolParkingInput {
  capitalUsdt: number;
  stakedAsset: 'BNB' | 'FDUSD' | 'USDT';
  launchpoolDurationDays: number;
  totalPoolStaked: number;
  dailyRewardPoolTokens: number;
  estimatedTokenListingPriceUsdt: number;
  alternativeEarnAprPct?: number;
}

export interface LaunchpoolParkingResult {
  capitalUsdt: number;
  stakedAsset: string;
  userPoolSharePct: number;
  dailyTokensEarned: number;
  totalTokensProjected: number;
  totalProjectedValueUsdt: number;
  impliedAnnualizedAprPct: number;
  earnOpportunityCostUsdt: number;
  netExcessProfitUsdt: number;
  isFavorableOverEarn: boolean;
}

export interface LiquidityLadderInput {
  totalTreasuryUsdt: number;
  dailyP2pVolumeUsdt: number;
  p2pTurnoverDays: number;
  flexibleAprPct: number;
  locked30dAprPct: number;
  locked60dAprPct: number;
  safetyBufferPct?: number;
}

export interface LiquidityLadderResult {
  totalTreasuryUsdt: number;
  flexibleBufferUsdt: number;
  locked30dUsdt: number;
  locked60dUsdt: number;
  blendedPortfolioAprPct: number;
  projectedAnnualYieldUsdt: number;
  liquidityCoverageRatio: number;
  weeklyRollingLiquidityUsdt: number;
}

export interface EarnHurdleRateInput {
  grossP2pSpreadPct: number;
  platformFeePct: number;
  bankingRiskPremiumPct: number;
  fxDevaluationRiskPct: number;
  averageTradeCycleHours: number;
  simpleEarnAprPct: number;
}

export interface EarnHurdleRateResult {
  netP2pCycleReturnPct: number;
  annualizedP2pRoiPct: number;
  hourlyP2pReturnPct: number;
  hourlyEarnYieldPct: number;
  hurdleSpreadPct: number;
  isP2pProfitableOverEarn: boolean;
  verdict: 'OPERATE_P2P' | 'PARK_IN_EARN' | 'ARBITRAGE_CYCLE_SUBOPTIMAL';
  reasoning: string;
}

export interface BnbVaultInput {
  bnbAmount: number;
  bnbPriceUsdt: number;
  simpleEarnAprPct: number;
  activeLaunchpoolsCount: number;
  averageLaunchpoolAprPct: number;
  hodlerAirdropProjectedAprPct?: number;
}

export interface BnbVaultResult {
  bnbAmount: number;
  totalBnbValueUsdt: number;
  simpleEarnYieldBnb: number;
  launchpoolYieldUsdt: number;
  airdropYieldUsdt: number;
  stackedBlendedAprPct: number;
  totalAnnualProjectedYieldUsdt: number;
}

export interface TierSaturationInput {
  totalCapitalUsdt: number;
  tier1LimitPerAccountUsdt?: number;
  tier1AprPct: number;
  tier2AprPct: number;
  availableSubaccountsCount?: number;
}

export interface TierSaturationResult {
  totalCapitalUsdt: number;
  tier1UtilizedUsdt: number;
  tier2DegradedUsdt: number;
  singleAccountEffectiveAprPct: number;
  multiAccountOptimizedAprPct: number;
  potentialAnnualSurplusUsdt: number;
  recommendedSubaccountsNeeded: number;
}

export interface AutoInvestDcaInput {
  monthlyP2pNetProfitUsdt: number;
  reinvestmentRatioPct: number;
  targetAsset: 'BTC' | 'ETH' | 'BNB' | 'SOL';
  projectedAnnualAssetGrowthPct?: number;
  executionFrequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY';
}

export interface AutoInvestDcaResult {
  monthlyReinvestedUsdt: number;
  retainedTreasuryUsdt: number;
  periodicInvestmentUsdt: number;
  projectedYearlyAllocatedUsdt: number;
  projectedEndValueUsdt: number;
  workingCapitalPreservationPct: number;
}

export interface InstantRedemptionInput {
  redemptionAmountUsdt: number;
  dailyInstantQuotaUsdt?: number;
  dailyQuotaConsumedUsdt?: number;
  averageSlippageOrDelayHours?: number;
}

export interface InstantRedemptionResult {
  requestedAmountUsdt: number;
  instantRedemptionAvailableUsdt: number;
  canExecuteInstant: boolean;
  standardRedemptionPendingUsdt: number;
  estimatedSettlementDelayHours: number;
  executionRisk: 'NEGLIGIBLE' | 'PARTIAL_DELAY' | 'HIGH_LATENCY';
  actionablePlan: string;
}

// ---------------------------------------------------------------------------
// 1. Optimize Idle Capital Simple Earn
// ---------------------------------------------------------------------------
export function optimizeIdleCapitalSimpleEarn(
  input: SimpleEarnOptimizationInput
): SimpleEarnOptimizationResult {
  const capital = Math.max(0, input.capitalUsdt);
  const tier1Limit = input.tier1LimitUsdt ?? 500;
  const t1Apr = Math.max(0, input.tier1AprPct) / 100;
  const t2Apr = Math.max(0, input.tier2AprPct) / 100;
  const days = Math.max(1, input.holdingDays ?? 30);

  const tier1Allocated = Math.min(capital, tier1Limit);
  const tier2Allocated = Math.max(0, capital - tier1Limit);

  const tier1AnnualYield = tier1Allocated * t1Apr;
  const tier2AnnualYield = tier2Allocated * t2Apr;
  const totalAnnualYield = tier1AnnualYield + tier2AnnualYield;

  const effectiveBlendedAprPct = capital > 0 ? (totalAnnualYield / capital) * 100 : 0;
  const dailyYieldUsdt = totalAnnualYield / 365;
  const monthlyYieldUsdt = (totalAnnualYield / 365) * 30;
  const projectedPeriodYieldUsdt = (totalAnnualYield / 365) * days;
  const opportunityCostPerHourUsdt = dailyYieldUsdt / 24;

  return {
    capitalUsdt: capital,
    tier1Allocated: Number(tier1Allocated.toFixed(2)),
    tier2Allocated: Number(tier2Allocated.toFixed(2)),
    effectiveBlendedAprPct: Number(effectiveBlendedAprPct.toFixed(2)),
    dailyYieldUsdt: Number(dailyYieldUsdt.toFixed(4)),
    monthlyYieldUsdt: Number(monthlyYieldUsdt.toFixed(2)),
    projectedPeriodYieldUsdt: Number(projectedPeriodYieldUsdt.toFixed(2)),
    opportunityCostPerHourUsdt: Number(opportunityCostPerHourUsdt.toFixed(5)),
  };
}

// ---------------------------------------------------------------------------
// 2. Evaluate Dual Investment P2P Exit
// ---------------------------------------------------------------------------
export function evaluateDualInvestmentP2pExit(
  input: DualInvestmentInput
): DualInvestmentResult {
  const spot = Math.max(0.0001, input.currentSpotPrice);
  const strike = Math.max(0.0001, input.strikePrice);
  const days = Math.max(1, input.durationDays);
  const apr = Math.max(0, input.annualizedAprPct) / 100;
  const capital = Math.max(0, input.investedCapitalUsdt);

  const periodYieldPct = (apr * days) / 365;
  const periodInterestUsdt = capital * periodYieldPct;

  const totalUsdtReturned = capital + periodInterestUsdt;
  const annualizedRoiPct = (periodInterestUsdt / capital) * (365 / days) * 100;

  const totalCryptoReceived = (capital + periodInterestUsdt) / strike;
  const effectiveExitPrice = strike;
  const profitVsSpotPct = ((strike - spot) / spot) * 100 + periodYieldPct * 100;

  let recommendation: 'SELL_HIGH_FAVORABLE' | 'HOLD_SPOT' | 'SPREAD_P2P_SUPERIOR';
  if (strike > spot && annualizedRoiPct > 15) {
    recommendation = 'SELL_HIGH_FAVORABLE';
  } else if (strike <= spot) {
    recommendation = 'SPREAD_P2P_SUPERIOR';
  } else {
    recommendation = 'HOLD_SPOT';
  }

  return {
    investedCapitalUsdt: capital,
    strikePrice: strike,
    durationDays: days,
    annualizedAprPct: input.annualizedAprPct,
    periodYieldPct: Number((periodYieldPct * 100).toFixed(3)),
    periodInterestUsdt: Number(periodInterestUsdt.toFixed(2)),
    outcomeIfExercised: {
      exercised: true,
      totalCryptoReceived: Number(totalCryptoReceived.toFixed(6)),
      effectiveExitPrice,
      profitVsSpotPct: Number(profitVsSpotPct.toFixed(2)),
    },
    outcomeIfNotExercised: {
      exercised: false,
      totalUsdtReturned: Number(totalUsdtReturned.toFixed(2)),
      netReturnUsdt: Number(periodInterestUsdt.toFixed(2)),
      annualizedRoiPct: Number(annualizedRoiPct.toFixed(2)),
    },
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// 3. Calculate USDT / FDUSD Yield Arbitrage
// ---------------------------------------------------------------------------
export function calculateUsdtFdusdYieldArbitrage(
  input: StablecoinYieldArbitrageInput
): StablecoinYieldArbitrageResult {
  const usdtBal = Math.max(0, input.usdtBalance);
  const fdusdBal = Math.max(0, input.fdusdBalance);
  const usdtApr = Math.max(0, input.usdtFlexibleAprPct) / 100;
  const fdusdApr = Math.max(0, input.fdusdFlexibleAprPct) / 100;
  const marketRate = input.usdtFdusdMarketRate ?? 1.0;
  const swapFee = (input.swapFeePct ?? 0) / 100;
  const horizon = input.plannedHorizonDays ?? 30;

  const currentUsdtYieldMonthly = (usdtBal * usdtApr * 30) / 365;
  const currentFdusdYieldMonthly = (fdusdBal * fdusdApr * 30) / 365;

  const rateSpreadPct = (fdusdApr - usdtApr) * 100;
  const pegDeviationPct = ((marketRate - 1.0) / 1.0) * 100;

  let optimalSwapDirection: 'SWAP_USDT_TO_FDUSD' | 'SWAP_FDUSD_TO_USDT' | 'MAINTAIN_EQUILIBRIUM';
  let breakevenDays = 0;
  let projectedNetAdvantageUsdt = 0;

  if (fdusdApr > usdtApr + 0.015 && marketRate <= 1.0005) {
    optimalSwapDirection = 'SWAP_USDT_TO_FDUSD';
    const netAprAdvantage = fdusdApr - usdtApr;
    breakevenDays = netAprAdvantage > 0 ? (swapFee / (netAprAdvantage / 365)) : 999;
    projectedNetAdvantageUsdt = usdtBal * (netAprAdvantage * horizon / 365) - usdtBal * swapFee;
  } else if (usdtApr > fdusdApr + 0.015 && marketRate >= 0.9995) {
    optimalSwapDirection = 'SWAP_FDUSD_TO_USDT';
    const netAprAdvantage = usdtApr - fdusdApr;
    breakevenDays = netAprAdvantage > 0 ? (swapFee / (netAprAdvantage / 365)) : 999;
    projectedNetAdvantageUsdt = fdusdBal * (netAprAdvantage * horizon / 365) - fdusdBal * swapFee;
  } else {
    optimalSwapDirection = 'MAINTAIN_EQUILIBRIUM';
    breakevenDays = 0;
    projectedNetAdvantageUsdt = 0;
  }

  const summary = `Arbitraje USDT/FDUSD: Spread APR ${(rateSpreadPct).toFixed(2)}%, Desvío Peg ${(pegDeviationPct).toFixed(3)}%. Dirección: ${optimalSwapDirection}.`;

  return {
    currentUsdtYieldMonthly: Number(currentUsdtYieldMonthly.toFixed(2)),
    currentFdusdYieldMonthly: Number(currentFdusdYieldMonthly.toFixed(2)),
    rateSpreadPct: Number(rateSpreadPct.toFixed(2)),
    pegDeviationPct: Number(pegDeviationPct.toFixed(3)),
    optimalSwapDirection,
    breakevenDays: Number(breakevenDays.toFixed(1)),
    projectedNetAdvantageUsdt: Number(projectedNetAdvantageUsdt.toFixed(2)),
    summary,
  };
}

// ---------------------------------------------------------------------------
// 4. Model Launchpool Capital Parking
// ---------------------------------------------------------------------------
export function modelLaunchpoolCapitalParking(
  input: LaunchpoolParkingInput
): LaunchpoolParkingResult {
  const capital = Math.max(0, input.capitalUsdt);
  const duration = Math.max(1, input.launchpoolDurationDays);
  const totalPool = Math.max(1, input.totalPoolStaked);
  const dailyPoolTokens = Math.max(0, input.dailyRewardPoolTokens);
  const tokenPrice = Math.max(0.0001, input.estimatedTokenListingPriceUsdt);
  const earnApr = (input.alternativeEarnAprPct ?? 2.5) / 100;

  const userSharePct = (capital / totalPool) * 100;
  const dailyTokensEarned = (dailyPoolTokens * capital) / totalPool;
  const totalTokensProjected = dailyTokensEarned * duration;
  const totalProjectedValueUsdt = totalTokensProjected * tokenPrice;

  const impliedAnnualizedAprPct = capital > 0
    ? (totalProjectedValueUsdt / capital) * (365 / duration) * 100
    : 0;

  const earnOpportunityCostUsdt = (capital * earnApr * duration) / 365;
  const netExcessProfitUsdt = totalProjectedValueUsdt - earnOpportunityCostUsdt;
  const isFavorableOverEarn = netExcessProfitUsdt > 0;

  return {
    capitalUsdt: capital,
    stakedAsset: input.stakedAsset,
    userPoolSharePct: Number(userSharePct.toFixed(6)),
    dailyTokensEarned: Number(dailyTokensEarned.toFixed(4)),
    totalTokensProjected: Number(totalTokensProjected.toFixed(2)),
    totalProjectedValueUsdt: Number(totalProjectedValueUsdt.toFixed(2)),
    impliedAnnualizedAprPct: Number(impliedAnnualizedAprPct.toFixed(2)),
    earnOpportunityCostUsdt: Number(earnOpportunityCostUsdt.toFixed(2)),
    netExcessProfitUsdt: Number(netExcessProfitUsdt.toFixed(2)),
    isFavorableOverEarn,
  };
}

// ---------------------------------------------------------------------------
// 5. Optimize Locked vs Flexible Liquidity Ladder
// ---------------------------------------------------------------------------
export function optimizeLockedVsFlexibleLiquidityLadder(
  input: LiquidityLadderInput
): LiquidityLadderResult {
  const totalTreasury = Math.max(0, input.totalTreasuryUsdt);
  const dailyVolume = Math.max(0, input.dailyP2pVolumeUsdt);
  const turnoverDays = Math.max(0.5, input.p2pTurnoverDays);
  const bufferPct = (input.safetyBufferPct ?? 30) / 100;

  const requiredOperationalBuffer = Math.min(
    totalTreasury,
    dailyVolume * turnoverDays * (1 + bufferPct)
  );

  const flexibleBufferUsdt = Math.max(totalTreasury * 0.35, requiredOperationalBuffer);
  const remainingForLocked = Math.max(0, totalTreasury - flexibleBufferUsdt);

  const locked30dUsdt = remainingForLocked * 0.65;
  const locked60dUsdt = remainingForLocked * 0.35;

  const flexApr = input.flexibleAprPct / 100;
  const l30Apr = input.locked30dAprPct / 100;
  const l60Apr = input.locked60dAprPct / 100;

  const totalAnnualYield =
    flexibleBufferUsdt * flexApr +
    locked30dUsdt * l30Apr +
    locked60dUsdt * l60Apr;

  const blendedPortfolioAprPct = totalTreasury > 0 ? (totalAnnualYield / totalTreasury) * 100 : 0;
  const liquidityCoverageRatio = dailyVolume > 0 ? flexibleBufferUsdt / dailyVolume : 10.0;
  const weeklyRollingLiquidityUsdt = flexibleBufferUsdt + locked30dUsdt / 4;

  return {
    totalTreasuryUsdt: totalTreasury,
    flexibleBufferUsdt: Number(flexibleBufferUsdt.toFixed(2)),
    locked30dUsdt: Number(locked30dUsdt.toFixed(2)),
    locked60dUsdt: Number(locked60dUsdt.toFixed(2)),
    blendedPortfolioAprPct: Number(blendedPortfolioAprPct.toFixed(2)),
    projectedAnnualYieldUsdt: Number(totalAnnualYield.toFixed(2)),
    liquidityCoverageRatio: Number(liquidityCoverageRatio.toFixed(2)),
    weeklyRollingLiquidityUsdt: Number(weeklyRollingLiquidityUsdt.toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// 6. Calculate Earn Yield vs P2P Hurdle Rate
// ---------------------------------------------------------------------------
export function calculateEarnYieldVsP2pHurdleRate(
  input: EarnHurdleRateInput
): EarnHurdleRateResult {
  const grossSpread = Math.max(0, input.grossP2pSpreadPct);
  const platformFee = Math.max(0, input.platformFeePct);
  const bankingRisk = Math.max(0, input.bankingRiskPremiumPct);
  const fxRisk = Math.max(0, input.fxDevaluationRiskPct);
  const cycleHours = Math.max(0.5, input.averageTradeCycleHours);
  const earnApr = Math.max(0, input.simpleEarnAprPct) / 100;

  const netP2pCycleReturnPct = grossSpread - platformFee - bankingRisk - fxRisk;
  const cyclesPerYear = (365 * 24) / cycleHours;
  const annualizedP2pRoiPct = netP2pCycleReturnPct * cyclesPerYear;

  const hourlyP2pReturnPct = netP2pCycleReturnPct / cycleHours;
  const hourlyEarnYieldPct = (earnApr / (365 * 24)) * 100;

  const hurdleSpreadPct = platformFee + bankingRisk + fxRisk + (hourlyEarnYieldPct * cycleHours);
  const isP2pProfitableOverEarn = hourlyP2pReturnPct > hourlyEarnYieldPct && netP2pCycleReturnPct > 0.35;

  let verdict: 'OPERATE_P2P' | 'PARK_IN_EARN' | 'ARBITRAGE_CYCLE_SUBOPTIMAL';
  let reasoning = '';

  if (isP2pProfitableOverEarn && netP2pCycleReturnPct >= 0.5) {
    verdict = 'OPERATE_P2P';
    reasoning = `El spread neto P2P (${netP2pCycleReturnPct.toFixed(2)}%) supera ampliamente la tasa libre de riesgo de Earn (${(hourlyEarnYieldPct * cycleHours).toFixed(4)}% por ciclo). Proceder con rotación P2P Maker.`;
  } else if (netP2pCycleReturnPct <= 0 || hourlyP2pReturnPct < hourlyEarnYieldPct) {
    verdict = 'PARK_IN_EARN';
    reasoning = `Riesgo cambiario y comisiones devoran el spread. El rendimiento libre de riesgo en Binance Simple Earn ofrece mayor retorno ajustado por riesgo. Recomendar estacionar capital en Simple Earn.`;
  } else {
    verdict = 'ARBITRAGE_CYCLE_SUBOPTIMAL';
    reasoning = `El spread P2P (${netP2pCycleReturnPct.toFixed(2)}%) es positivo pero marginal frente a la fricción operativa y bancaria. Mantener postura defensiva.`;
  }

  return {
    netP2pCycleReturnPct: Number(netP2pCycleReturnPct.toFixed(3)),
    annualizedP2pRoiPct: Number(annualizedP2pRoiPct.toFixed(1)),
    hourlyP2pReturnPct: Number(hourlyP2pReturnPct.toFixed(4)),
    hourlyEarnYieldPct: Number(hourlyEarnYieldPct.toFixed(6)),
    hurdleSpreadPct: Number(hurdleSpreadPct.toFixed(3)),
    isP2pProfitableOverEarn,
    verdict,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// 7. Model BNB Vault Yield Stacking
// ---------------------------------------------------------------------------
export function modelBnbVaultYieldStacking(
  input: BnbVaultInput
): BnbVaultResult {
  const bnbAmount = Math.max(0, input.bnbAmount);
  const bnbPrice = Math.max(1, input.bnbPriceUsdt);
  const totalBnbValueUsdt = bnbAmount * bnbPrice;

  const earnApr = Math.max(0, input.simpleEarnAprPct) / 100;
  const launchpools = Math.max(0, input.activeLaunchpoolsCount);
  const avgLaunchpoolApr = (Math.max(0, input.averageLaunchpoolAprPct) / 100) * launchpools;
  const airdropApr = (input.hodlerAirdropProjectedAprPct ?? 3.5) / 100;

  const simpleEarnYieldBnb = bnbAmount * earnApr;
  const launchpoolYieldUsdt = totalBnbValueUsdt * avgLaunchpoolApr;
  const airdropYieldUsdt = totalBnbValueUsdt * airdropApr;

  const stackedBlendedAprPct = (earnApr + avgLaunchpoolApr + airdropApr) * 100;
  const totalAnnualProjectedYieldUsdt =
    simpleEarnYieldBnb * bnbPrice + launchpoolYieldUsdt + airdropYieldUsdt;

  return {
    bnbAmount,
    totalBnbValueUsdt: Number(totalBnbValueUsdt.toFixed(2)),
    simpleEarnYieldBnb: Number(simpleEarnYieldBnb.toFixed(4)),
    launchpoolYieldUsdt: Number(launchpoolYieldUsdt.toFixed(2)),
    airdropYieldUsdt: Number(airdropYieldUsdt.toFixed(2)),
    stackedBlendedAprPct: Number(stackedBlendedAprPct.toFixed(2)),
    totalAnnualProjectedYieldUsdt: Number(totalAnnualProjectedYieldUsdt.toFixed(2)),
  };
}

// ---------------------------------------------------------------------------
// 8. Forecast Flexible Earn Tier Saturation
// ---------------------------------------------------------------------------
export function forecastFlexibleEarnTierSaturation(
  input: TierSaturationInput
): TierSaturationResult {
  const totalCapital = Math.max(0, input.totalCapitalUsdt);
  const tier1Limit = input.tier1LimitPerAccountUsdt ?? 500;
  const t1Apr = Math.max(0, input.tier1AprPct) / 100;
  const t2Apr = Math.max(0, input.tier2AprPct) / 100;
  const availableSubaccounts = Math.max(1, input.availableSubaccountsCount ?? 3);

  const tier1UtilizedUsdt = Math.min(totalCapital, tier1Limit);
  const tier2DegradedUsdt = Math.max(0, totalCapital - tier1Limit);

  const singleAccountAnnualYield = tier1UtilizedUsdt * t1Apr + tier2DegradedUsdt * t2Apr;
  const singleAccountEffectiveAprPct = totalCapital > 0 ? (singleAccountAnnualYield / totalCapital) * 100 : 0;

  const multiAccountTier1Capacity = tier1Limit * availableSubaccounts;
  const multiTier1Allocated = Math.min(totalCapital, multiAccountTier1Capacity);
  const multiTier2Allocated = Math.max(0, totalCapital - multiAccountTier1Capacity);

  const multiAccountAnnualYield = multiTier1Allocated * t1Apr + multiTier2Allocated * t2Apr;
  const multiAccountOptimizedAprPct = totalCapital > 0 ? (multiAccountAnnualYield / totalCapital) * 100 : 0;

  const potentialAnnualSurplusUsdt = multiAccountAnnualYield - singleAccountAnnualYield;
  const recommendedSubaccountsNeeded = Math.ceil(totalCapital / tier1Limit);

  return {
    totalCapitalUsdt: totalCapital,
    tier1UtilizedUsdt: Number(tier1UtilizedUsdt.toFixed(2)),
    tier2DegradedUsdt: Number(tier2DegradedUsdt.toFixed(2)),
    singleAccountEffectiveAprPct: Number(singleAccountEffectiveAprPct.toFixed(2)),
    multiAccountOptimizedAprPct: Number(multiAccountOptimizedAprPct.toFixed(2)),
    potentialAnnualSurplusUsdt: Number(potentialAnnualSurplusUsdt.toFixed(2)),
    recommendedSubaccountsNeeded,
  };
}

// ---------------------------------------------------------------------------
// 9. Calculate Auto-Invest DCA Spread Funnel
// ---------------------------------------------------------------------------
export function calculateAutoInvestDcaSpreadFunnel(
  input: AutoInvestDcaInput
): AutoInvestDcaResult {
  const monthlyProfit = Math.max(0, input.monthlyP2pNetProfitUsdt);
  const ratio = Math.min(100, Math.max(0, input.reinvestmentRatioPct)) / 100;
  const assetGrowth = (input.projectedAnnualAssetGrowthPct ?? 15) / 100;

  const monthlyReinvestedUsdt = monthlyProfit * ratio;
  const retainedTreasuryUsdt = monthlyProfit - monthlyReinvestedUsdt;

  let periodicInvestmentUsdt = 0;
  if (input.executionFrequency === 'DAILY') {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 30;
  } else if (input.executionFrequency === 'WEEKLY') {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 4;
  } else {
    periodicInvestmentUsdt = monthlyReinvestedUsdt / 2;
  }

  const projectedYearlyAllocatedUsdt = monthlyReinvestedUsdt * 12;
  const projectedEndValueUsdt = projectedYearlyAllocatedUsdt * (1 + assetGrowth / 2);
  const workingCapitalPreservationPct = 100 - input.reinvestmentRatioPct;

  return {
    monthlyReinvestedUsdt: Number(monthlyReinvestedUsdt.toFixed(2)),
    retainedTreasuryUsdt: Number(retainedTreasuryUsdt.toFixed(2)),
    periodicInvestmentUsdt: Number(periodicInvestmentUsdt.toFixed(2)),
    projectedYearlyAllocatedUsdt: Number(projectedYearlyAllocatedUsdt.toFixed(2)),
    projectedEndValueUsdt: Number(projectedEndValueUsdt.toFixed(2)),
    workingCapitalPreservationPct: Number(workingCapitalPreservationPct.toFixed(1)),
  };
}

// ---------------------------------------------------------------------------
// 10. Simulate Earn Instant Redemption Latency
// ---------------------------------------------------------------------------
export function simulateEarnInstantRedemptionLatency(
  input: InstantRedemptionInput
): InstantRedemptionResult {
  const requested = Math.max(0, input.redemptionAmountUsdt);
  const dailyQuota = input.dailyInstantQuotaUsdt ?? 1000000;
  const quotaConsumed = input.dailyQuotaConsumedUsdt ?? 0;
  const delayHours = input.averageSlippageOrDelayHours ?? 0.1;

  const availableQuota = Math.max(0, dailyQuota - quotaConsumed);
  const canExecuteInstant = requested <= availableQuota;

  const instantRedemptionAvailableUsdt = Math.min(requested, availableQuota);
  const standardRedemptionPendingUsdt = Math.max(0, requested - availableQuota);

  let executionRisk: 'NEGLIGIBLE' | 'PARTIAL_DELAY' | 'HIGH_LATENCY';
  let actionablePlan = '';

  if (canExecuteInstant) {
    executionRisk = 'NEGLIGIBLE';
    actionablePlan = 'Rescate instantáneo aprobado al 100%. Fondos acreditados inmediatamente a Billetera Spot sin demora para atender la orden P2P.';
  } else if (instantRedemptionAvailableUsdt > 0) {
    executionRisk = 'PARTIAL_DELAY';
    actionablePlan = `Cuota diaria superada parcialmente. Rescatar ${instantRedemptionAvailableUsdt.toFixed(2)} USDT de forma inmediata y solicitar el excedente (${standardRedemptionPendingUsdt.toFixed(2)} USDT) mediante Standard Redemption (D+1 00:00 UTC).`;
  } else {
    executionRisk = 'HIGH_LATENCY';
    actionablePlan = 'Cuota diaria de rescate instantáneo agotada. Retiro diferido a D+1. Suspender colocación de órdenes Maker hasta reposición de liquidez.';
  }

  return {
    requestedAmountUsdt: requested,
    instantRedemptionAvailableUsdt: Number(instantRedemptionAvailableUsdt.toFixed(2)),
    canExecuteInstant,
    standardRedemptionPendingUsdt: Number(standardRedemptionPendingUsdt.toFixed(2)),
    estimatedSettlementDelayHours: canExecuteInstant ? 0 : delayHours,
    executionRisk,
    actionablePlan,
  };
}
