import { describe, it, expect } from 'vitest';
import {
  optimizeIdleCapitalSimpleEarn,
  evaluateDualInvestmentP2pExit,
  calculateUsdtFdusdYieldArbitrage,
  modelLaunchpoolCapitalParking,
  optimizeLockedVsFlexibleLiquidityLadder,
  calculateEarnYieldVsP2pHurdleRate,
  modelBnbVaultYieldStacking,
  forecastFlexibleEarnTierSaturation,
  calculateAutoInvestDcaSpreadFunnel,
  simulateEarnInstantRedemptionLatency,
} from './binance-earn-vault';

describe('Binance Earn Vault & Passive Treasury Optimization', () => {
  describe('optimizeIdleCapitalSimpleEarn', () => {
    it('allocates correctly within Tier 1 and Tier 2 and calculates blended APR', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 2000,
        tier1LimitUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        holdingDays: 30,
      });

      expect(result.capitalUsdt).toBe(2000);
      expect(result.tier1Allocated).toBe(500);
      expect(result.tier2Allocated).toBe(1500);
      // Tier 1: 500 * 0.10 = 50. Tier 2: 1500 * 0.02 = 30. Total = 80/2000 = 4.0%
      expect(result.effectiveBlendedAprPct).toBe(4.0);
      expect(result.dailyYieldUsdt).toBeCloseTo(80 / 365, 4);
      expect(result.monthlyYieldUsdt).toBeCloseTo((80 / 365) * 30, 2);
      expect(result.opportunityCostPerHourUsdt).toBeGreaterThan(0);
    });

    it('reports zero capital without inventing a tier split', () => {
      // The original assertion here (`effectiveBlendedAprPct === 0`,
      // `dailyYieldUsdt === 0`) was only satisfiable because the engine
      // assumed a 500 USDT Tier 1 limit and a 30-day horizon. Zero capital is
      // a real measurement; the missing inputs are still absences.
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 0,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
      });
      expect(result.capitalUsdt).toBe(0);
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['tier1LimitUsdt', 'holdingDays']);
      expect(result.effectiveBlendedAprPct).toBeNull();
      expect(result.dailyYieldUsdt).toBeNull();
    });

    it('still yields zero on zero capital when the tier limit is measured', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 0,
        tier1LimitUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        holdingDays: 30,
      });
      expect(result.assessmentStatus).toBe('ASSESSED');
      expect(result.effectiveBlendedAprPct).toBe(0);
      expect(result.dailyYieldUsdt).toBe(0);
    });
  });

  describe('evaluateDualInvestmentP2pExit', () => {
    it('evaluates Sell High option when strike price is above spot', () => {
      const result = evaluateDualInvestmentP2pExit({
        currentSpotPrice: 65000,
        strikePrice: 68000,
        durationDays: 7,
        annualizedAprPct: 25.0,
        investedCapitalUsdt: 10000,
      });

      expect(result.investedCapitalUsdt).toBe(10000);
      expect(result.strikePrice).toBe(68000);
      expect(result.recommendation).toBe('SELL_HIGH_FAVORABLE');
      expect(result.outcomeIfExercised.exercised).toBe(true);
      expect(result.outcomeIfNotExercised.exercised).toBe(false);
      expect(result.periodInterestUsdt).toBeGreaterThan(0);
    });

    it('suggests P2P spread when strike is below or equal to spot', () => {
      const result = evaluateDualInvestmentP2pExit({
        currentSpotPrice: 65000,
        strikePrice: 64000,
        durationDays: 3,
        annualizedAprPct: 10.0,
        investedCapitalUsdt: 5000,
      });

      expect(result.recommendation).toBe('SPREAD_P2P_SUPERIOR');
    });
  });

  describe('calculateUsdtFdusdYieldArbitrage', () => {
    it('detects favorable arbitrage when FDUSD APR significantly exceeds USDT APR', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 10000,
        fdusdBalance: 2000,
        usdtFlexibleAprPct: 2.5,
        fdusdFlexibleAprPct: 7.5,
        usdtFdusdMarketRate: 1.0001,
        swapFeePct: 0.0,
        plannedHorizonDays: 30,
      });

      expect(result.optimalSwapDirection).toBe('SWAP_USDT_TO_FDUSD');
      expect(result.rateSpreadPct).toBe(5.0);
      expect(result.projectedNetAdvantageUsdt).toBeGreaterThan(0);
    });

    it('declares the absence instead of maintaining an equilibrium on an unmeasured peg', () => {
      // The original assertion here (`MAINTAIN_EQUILIBRIUM` with no
      // `usdtFdusdMarketRate`) asserted the bug: without a measured rate the
      // engine read a perfect 1.0 peg and produced a swap verdict from it.
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 5000,
        fdusdBalance: 5000,
        usdtFlexibleAprPct: 3.0,
        fdusdFlexibleAprPct: 3.2,
      });

      expect(result.optimalSwapDirection).toBe('NOT_ASSESSED');
      expect(result.pegDeviationPct).toBeNull();
      expect(result.missingInputs).toContain('usdtFdusdMarketRate');
    });

    it('maintains equilibrium on a measured peg', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 5000,
        fdusdBalance: 5000,
        usdtFlexibleAprPct: 3.0,
        fdusdFlexibleAprPct: 3.2,
        usdtFdusdMarketRate: 1.0,
        swapFeePct: 0.1,
        plannedHorizonDays: 30,
      });
      expect(result.optimalSwapDirection).toBe('MAINTAIN_EQUILIBRIUM');
      expect(result.pegDeviationPct).toBe(0);
      expect(result.assessmentStatus).toBe('ASSESSED');
    });
  });

  describe('modelLaunchpoolCapitalParking', () => {
    it('computes user share and projected APY in Launchpool', () => {
      const result = modelLaunchpoolCapitalParking({
        capitalUsdt: 10000,
        stakedAsset: 'FDUSD',
        launchpoolDurationDays: 4,
        totalPoolStaked: 100000000,
        dailyRewardPoolTokens: 250000,
        estimatedTokenListingPriceUsdt: 2.5,
        alternativeEarnAprPct: 3.0,
      });

      expect(result.userPoolSharePct).toBeCloseTo(0.01, 4);
      expect(result.dailyTokensEarned).toBeCloseTo(25, 2);
      expect(result.totalTokensProjected).toBeCloseTo(100, 2);
      expect(result.totalProjectedValueUsdt).toBe(250);
      expect(result.impliedAnnualizedAprPct).toBeGreaterThan(100);
      expect(result.isFavorableOverEarn).toBe(true);
    });
  });

  describe('optimizeLockedVsFlexibleLiquidityLadder', () => {
    it('divides capital into flexible operational buffer and locked tramos', () => {
      const result = optimizeLockedVsFlexibleLiquidityLadder({
        totalTreasuryUsdt: 50000,
        dailyP2pVolumeUsdt: 10000,
        p2pTurnoverDays: 1.5,
        flexibleAprPct: 2.5,
        locked30dAprPct: 6.0,
        locked60dAprPct: 8.5,
        safetyBufferPct: 30,
      });

      expect(result.totalTreasuryUsdt).toBe(50000);
      expect(result.assessmentStatus).toBe('ASSESSED');
      expect(result.flexibleBufferUsdt!).toBeGreaterThanOrEqual(19500); // 10000 * 1.5 * 1.3
      expect(result.locked30dUsdt! + result.locked60dUsdt!).toBeCloseTo(
        result.totalTreasuryUsdt - result.flexibleBufferUsdt!,
        1,
      );
      expect(result.blendedPortfolioAprPct!).toBeGreaterThan(
        result.flexibleBufferUsdt! > 0 ? 2.5 : 0,
      );
      expect(result.liquidityCoverageRatio!).toBeGreaterThan(1.0);
    });
  });

  describe('calculateEarnYieldVsP2pHurdleRate', () => {
    it('recommends P2P operation when net spread well exceeds hurdle rate', () => {
      const result = calculateEarnYieldVsP2pHurdleRate({
        grossP2pSpreadPct: 1.8,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: 2,
        simpleEarnAprPct: 4.0,
      });

      expect(result.netP2pCycleReturnPct).toBe(1.2);
      expect(result.isP2pProfitableOverEarn).toBe(true);
      expect(result.verdict).toBe('OPERATE_P2P');
    });

    it('recommends parking in Earn when fees and FX risk destroy the spread', () => {
      const result = calculateEarnYieldVsP2pHurdleRate({
        grossP2pSpreadPct: 0.4,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.5,
        averageTradeCycleHours: 4,
        simpleEarnAprPct: 5.0,
      });

      expect(result.netP2pCycleReturnPct).toBeLessThan(0);
      expect(result.isP2pProfitableOverEarn).toBe(false);
      expect(result.verdict).toBe('PARK_IN_EARN');
    });
  });

  describe('modelBnbVaultYieldStacking', () => {
    it('stacks Simple Earn, Launchpool and airdrops for BNB holdings', () => {
      const result = modelBnbVaultYieldStacking({
        bnbAmount: 20,
        bnbPriceUsdt: 600,
        simpleEarnAprPct: 1.5,
        activeLaunchpoolsCount: 1,
        averageLaunchpoolAprPct: 15.0,
        hodlerAirdropProjectedAprPct: 3.5,
      });

      expect(result.totalBnbValueUsdt).toBe(12000);
      expect(result.stackedBlendedAprPct).toBe(20.0);
      expect(result.totalAnnualProjectedYieldUsdt).toBeCloseTo(2400, 1);
    });
  });

  describe('forecastFlexibleEarnTierSaturation', () => {
    it('calculates degradation in single account and benefits of subaccount dispersion', () => {
      const result = forecastFlexibleEarnTierSaturation({
        totalCapitalUsdt: 2500,
        tier1LimitPerAccountUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        availableSubaccountsCount: 5,
      });

      expect(result.totalCapitalUsdt).toBe(2500);
      expect(result.tier1UtilizedUsdt).toBe(500);
      expect(result.tier2DegradedUsdt).toBe(2000);
      expect(result.multiAccountOptimizedAprPct).toBe(10.0); // 5 subaccounts * 500 = 2500 all at Tier 1
      expect(result.singleAccountEffectiveAprPct).toBeLessThan(10.0);
      expect(result.potentialAnnualSurplusUsdt).toBeGreaterThan(0);
      expect(result.recommendedSubaccountsNeeded).toBe(5);
    });
  });

  describe('calculateAutoInvestDcaSpreadFunnel', () => {
    it('allocates designated percentage of monthly profit without eating principal', () => {
      const result = calculateAutoInvestDcaSpreadFunnel({
        monthlyP2pNetProfitUsdt: 3000,
        reinvestmentRatioPct: 25,
        targetAsset: 'BTC',
        projectedAnnualAssetGrowthPct: 20,
        executionFrequency: 'WEEKLY',
      });

      expect(result.monthlyReinvestedUsdt).toBe(750);
      expect(result.retainedTreasuryUsdt).toBe(2250);
      expect(result.periodicInvestmentUsdt).toBe(187.5);
      expect(result.workingCapitalPreservationPct).toBe(75);
    });
  });

  describe('simulateEarnInstantRedemptionLatency', () => {
    it('confirms instant redemption when within quota', () => {
      const result = simulateEarnInstantRedemptionLatency({
        redemptionAmountUsdt: 5000,
        dailyInstantQuotaUsdt: 1000000,
        dailyQuotaConsumedUsdt: 100000,
      });

      expect(result.canExecuteInstant).toBe(true);
      expect(result.executionRisk).toBe('NEGLIGIBLE');
      expect(result.estimatedSettlementDelayHours).toBe(0);
    });

    it('warns partial delay when exceeding remaining quota', () => {
      const result = simulateEarnInstantRedemptionLatency({
        redemptionAmountUsdt: 15000,
        dailyInstantQuotaUsdt: 20000,
        dailyQuotaConsumedUsdt: 10000,
      });

      expect(result.canExecuteInstant).toBe(false);
      expect(result.instantRedemptionAvailableUsdt).toBe(10000);
      expect(result.standardRedemptionPendingUsdt).toBe(5000);
      expect(result.executionRisk).toBe('PARTIAL_DELAY');
    });
  });
});

// ===========================================================================
// Fail-closed contract: an absent measurement is `null` plus a declared
// absence that names the required source. It is never a number.
//
// Every test below deliberately omits ONE measurement that the model needs
// and asserts the absence is declared instead of silently filled.
// ===========================================================================

/**
 * A caller that could not supply the measurement.
 *
 * Typed through a cast so this spec stays valid against both the old
 * non-null signature and the honest nullable one.
 */
const NOT_MEASURED = undefined as unknown as number | null;

/** Collects every path whose value is a non-finite number (NaN / ±Infinity). */
function nonFinitePaths(value: unknown, path = '$'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonFinitePaths(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => nonFinitePaths(v, `${path}.${k}`));
  }
  return [];
}

/**
 * The `Math.max(0.0001, undefined)` class of bug: a clamp does not guard
 * absence, it poisons every downstream operation with NaN. No result in this
 * module may ever contain a non-finite number.
 */
function expectNoNonFiniteNumbers(result: unknown, label: string): void {
  expect(nonFinitePaths(result), `${label} leaked a non-finite number`).toEqual([]);
}

describe('Binance Earn Vault — ausente de mediciones (fail-closed)', () => {
  describe('1. optimizeIdleCapitalSimpleEarn', () => {
    it('declares the absence when tier1LimitUsdt is not measured', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 2000,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        holdingDays: 30,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['tier1LimitUsdt']);
      expect(result.expectedSource).toBeTruthy();
      expect(result.tier1Allocated).toBeNull();
      expect(result.tier2Allocated).toBeNull();
      expect(result.effectiveBlendedAprPct).toBeNull();
      expect(result.dailyYieldUsdt).toBeNull();
      expect(result.monthlyYieldUsdt).toBeNull();
      expect(result.opportunityCostPerHourUsdt).toBeNull();
      // The measured capital is still reported.
      expect(result.capitalUsdt).toBe(2000);
      expectNoNonFiniteNumbers(result, 'optimizeIdleCapitalSimpleEarn w/o tier1LimitUsdt');
    });

    it('never reports the invented 500 USDT tier-1 split', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 2000,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        holdingDays: 30,
      });

      // The old default answered tier1Allocated=500 / tier2Allocated=1500.
      expect(JSON.stringify(result)).not.toContain('"tier1Allocated":500');
      expect(JSON.stringify(result)).not.toContain('"tier2Allocated":1500');
    });

    it('nulls only the period projection when holdingDays is not measured', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 2000,
        tier1LimitUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
      });

      expect(result.projectedPeriodYieldUsdt).toBeNull();
      expect(result.missingInputs).toEqual(['holdingDays']);
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      // Everything not dependent on the horizon stays measured.
      expect(result.tier1Allocated).toBe(500);
      expect(result.effectiveBlendedAprPct).toBe(4.0);
      expectNoNonFiniteNumbers(result, 'optimizeIdleCapitalSimpleEarn w/o holdingDays');
    });
  });

  describe('2. evaluateDualInvestmentP2pExit', () => {
    it('declares the absence instead of clamping an unmeasured spot to 0.0001', () => {
      const result = evaluateDualInvestmentP2pExit({
        currentSpotPrice: NOT_MEASURED,
        strikePrice: 68000,
        durationDays: 7,
        annualizedAprPct: 25.0,
        investedCapitalUsdt: 10000,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['currentSpotPrice']);
      expect(result.recommendation).toBe('NOT_ASSESSED');
      expect(result.outcomeIfExercised.profitVsSpotPct).toBeNull();
      // The math that does not need spot stays measured.
      expect(result.periodInterestUsdt).toBeGreaterThan(0);
      expectNoNonFiniteNumbers(result, 'evaluateDualInvestmentP2pExit w/o spot');
    });

    it('declares the absence instead of clamping an unmeasured strike to 0.0001', () => {
      const result = evaluateDualInvestmentP2pExit({
        currentSpotPrice: 65000,
        strikePrice: NOT_MEASURED,
        durationDays: 7,
        annualizedAprPct: 25.0,
        investedCapitalUsdt: 10000,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['strikePrice']);
      expect(result.recommendation).toBe('NOT_ASSESSED');
      expect(result.strikePrice).toBeNull();
      expect(result.outcomeIfExercised.totalCryptoReceived).toBeNull();
      expect(result.outcomeIfExercised.effectiveExitPrice).toBeNull();
      expectNoNonFiniteNumbers(result, 'evaluateDualInvestmentP2pExit w/o strike');
    });
  });

  describe('3. calculateUsdtFdusdYieldArbitrage — el caso grave', () => {
    it('never turns a missing market rate into a swap order', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 10000,
        fdusdBalance: 2000,
        usdtFlexibleAprPct: 2.5,
        fdusdFlexibleAprPct: 7.5,
        swapFeePct: 0.1,
        plannedHorizonDays: 30,
      });

      expect(result.optimalSwapDirection).toBe('NOT_ASSESSED');
      expect(result.pegDeviationPct).toBeNull();
      expect(result.projectedNetAdvantageUsdt).toBeNull();
      expect(result.breakevenDays).toBeNull();
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['usdtFdusdMarketRate']);
      expect(result.expectedSource).toBeTruthy();

      // Hunts the literal anywhere in the payload, not only in the typed field.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('SWAP_USDT_TO_FDUSD');
      expect(serialized).not.toContain('SWAP_FDUSD_TO_USDT');
      expect(serialized).not.toContain('Desvío Peg 0.000');

      // The yield figures that rest on real inputs are still reported.
      expect(result.rateSpreadPct).toBe(5.0);
      expect(result.currentUsdtYieldMonthly).toBeGreaterThan(0);
      expectNoNonFiniteNumbers(result, 'calculateUsdtFdusdYieldArbitrage w/o market rate');
    });

    it('names the required source in the summary instead of claiming a 0.000% peg', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 10000,
        fdusdBalance: 2000,
        usdtFlexibleAprPct: 2.5,
        fdusdFlexibleAprPct: 7.5,
      });

      expect(result.summary).toContain('usdtFdusdMarketRate');
      expect(result.summary).not.toMatch(/Desvío Peg \d/);
    });

    it('nulls the money figures when swapFeePct is not measured', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 10000,
        fdusdBalance: 2000,
        usdtFlexibleAprPct: 2.5,
        fdusdFlexibleAprPct: 7.5,
        usdtFdusdMarketRate: 1.0001,
        plannedHorizonDays: 30,
      });

      expect(result.missingInputs).toEqual(['swapFeePct']);
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.projectedNetAdvantageUsdt).toBeNull();
      expect(result.breakevenDays).toBeNull();
      // Direction rests on measured APR + peg, so it survives.
      expect(result.optimalSwapDirection).toBe('SWAP_USDT_TO_FDUSD');
      expect(result.pegDeviationPct).toBe(0.01);
    });

    it('nulls the projection when plannedHorizonDays is not measured', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 10000,
        fdusdBalance: 2000,
        usdtFlexibleAprPct: 2.5,
        fdusdFlexibleAprPct: 7.5,
        usdtFdusdMarketRate: 1.0001,
        swapFeePct: 0.0,
      });

      expect(result.missingInputs).toEqual(['plannedHorizonDays']);
      expect(result.projectedNetAdvantageUsdt).toBeNull();
      expect(result.breakevenDays).toBe(0);
      expect(result.optimalSwapDirection).toBe('SWAP_USDT_TO_FDUSD');
    });
  });

  describe('4. modelLaunchpoolCapitalParking', () => {
    it('declares the absence of the alternative Earn APR instead of assuming 2.5%', () => {
      const result = modelLaunchpoolCapitalParking({
        capitalUsdt: 10000,
        stakedAsset: 'FDUSD',
        launchpoolDurationDays: 4,
        totalPoolStaked: 100000000,
        dailyRewardPoolTokens: 250000,
        estimatedTokenListingPriceUsdt: 2.5,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['alternativeEarnAprPct']);
      expect(result.earnOpportunityCostUsdt).toBeNull();
      expect(result.netExcessProfitUsdt).toBeNull();
      expect(result.isFavorableOverEarn).toBeNull();
      // The pool math rests on measured inputs.
      expect(result.totalProjectedValueUsdt).toBe(250);
    });

    it('does not fabricate a listing price out of an unmeasured one', () => {
      const result = modelLaunchpoolCapitalParking({
        capitalUsdt: 10000,
        stakedAsset: 'FDUSD',
        launchpoolDurationDays: 4,
        totalPoolStaked: 100000000,
        dailyRewardPoolTokens: 250000,
        estimatedTokenListingPriceUsdt: NOT_MEASURED,
        alternativeEarnAprPct: 3.0,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['estimatedTokenListingPriceUsdt']);
      expect(result.totalProjectedValueUsdt).toBeNull();
      expect(result.impliedAnnualizedAprPct).toBeNull();
      expect(result.isFavorableOverEarn).toBeNull();
      // The old `Math.max(0.0001, undefined)` produced NaN here.
      expectNoNonFiniteNumbers(result, 'modelLaunchpoolCapitalParking w/o listing price');
    });

    it('does not fabricate a total pool staked out of an unmeasured one', () => {
      const result = modelLaunchpoolCapitalParking({
        capitalUsdt: 10000,
        stakedAsset: 'FDUSD',
        launchpoolDurationDays: 4,
        totalPoolStaked: NOT_MEASURED,
        dailyRewardPoolTokens: 250000,
        estimatedTokenListingPriceUsdt: 2.5,
        alternativeEarnAprPct: 3.0,
      });

      expect(result.missingInputs).toEqual(['totalPoolStaked']);
      expect(result.userPoolSharePct).toBeNull();
      expect(result.dailyTokensEarned).toBeNull();
      expect(result.totalTokensProjected).toBeNull();
      expect(result.totalProjectedValueUsdt).toBeNull();
      expectNoNonFiniteNumbers(result, 'modelLaunchpoolCapitalParking w/o total pool');
    });

    it('does not fabricate a launchpool duration out of an unmeasured one', () => {
      const result = modelLaunchpoolCapitalParking({
        capitalUsdt: 10000,
        stakedAsset: 'FDUSD',
        launchpoolDurationDays: NOT_MEASURED,
        totalPoolStaked: 100000000,
        dailyRewardPoolTokens: 250000,
        estimatedTokenListingPriceUsdt: 2.5,
        alternativeEarnAprPct: 3.0,
      });

      expect(result.missingInputs).toEqual(['launchpoolDurationDays']);
      expect(result.totalTokensProjected).toBeNull();
      expect(result.impliedAnnualizedAprPct).toBeNull();
      expect(result.earnOpportunityCostUsdt).toBeNull();
      // Share and daily accrual do not depend on the duration.
      expect(result.userPoolSharePct).toBeCloseTo(0.01, 4);
      expectNoNonFiniteNumbers(result, 'modelLaunchpoolCapitalParking w/o duration');
    });
  });

  describe('5. optimizeLockedVsFlexibleLiquidityLadder', () => {
    it('declares the absence of the safety buffer policy instead of assuming 30%', () => {
      const result = optimizeLockedVsFlexibleLiquidityLadder({
        totalTreasuryUsdt: 50000,
        dailyP2pVolumeUsdt: 10000,
        p2pTurnoverDays: 1.5,
        flexibleAprPct: 2.5,
        locked30dAprPct: 6.0,
        locked60dAprPct: 8.5,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['safetyBufferPct']);
      expect(result.flexibleBufferUsdt).toBeNull();
      expect(result.locked30dUsdt).toBeNull();
      expect(result.locked60dUsdt).toBeNull();
      expect(result.blendedPortfolioAprPct).toBeNull();
      expect(result.projectedAnnualYieldUsdt).toBeNull();
      expect(result.liquidityCoverageRatio).toBeNull();
      expect(result.weeklyRollingLiquidityUsdt).toBeNull();
      expect(result.totalTreasuryUsdt).toBe(50000);
    });

    it('reports no liquidity coverage ratio instead of inventing 10 days of cover', () => {
      const result = optimizeLockedVsFlexibleLiquidityLadder({
        totalTreasuryUsdt: 50000,
        dailyP2pVolumeUsdt: 0,
        p2pTurnoverDays: 1.5,
        flexibleAprPct: 2.5,
        locked30dAprPct: 6.0,
        locked60dAprPct: 8.5,
        safetyBufferPct: 30,
      });

      // The old ternary answered 10.0 days of coverage for a book with no volume.
      expect(result.liquidityCoverageRatio).toBeNull();
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['dailyP2pVolumeUsdt']);
      expect(JSON.stringify(result)).not.toContain('"liquidityCoverageRatio":10');
    });

    it('declares the absence of the flexible APR and keeps the capital split measured', () => {
      // `flexibleAprPct` comes straight from `effectiveBlendedAprPct`, which is
      // itself nullable once the tier limit or horizon is unmeasured. Forcing it
      // back to `number` at the boundary would just relocate the fabrication.
      const result = optimizeLockedVsFlexibleLiquidityLadder({
        totalTreasuryUsdt: 50000,
        dailyP2pVolumeUsdt: 10000,
        p2pTurnoverDays: 1.5,
        flexibleAprPct: NOT_MEASURED,
        locked30dAprPct: 6.0,
        locked60dAprPct: 8.5,
        safetyBufferPct: 30,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['flexibleAprPct']);
      expect(result.blendedPortfolioAprPct).toBeNull();
      expect(result.projectedAnnualYieldUsdt).toBeNull();
      // The split is a treasury policy decision and needs no APR: it stays measured.
      // 10000 * 1.5 * 1.3 = 19500, floored at 35% of treasury, leaving 30500.
      expect(result.flexibleBufferUsdt).toBe(19500);
      expect(result.locked30dUsdt).toBe(19825);
      expect(result.locked60dUsdt).toBe(10675);
      expect(result.liquidityCoverageRatio).toBe(1.95);
      expectNoNonFiniteNumbers(result, 'liquidity ladder w/o flexible APR');
    });

    it('declares the absence of the P2P turnover instead of assuming 1 day', () => {
      const result = optimizeLockedVsFlexibleLiquidityLadder({
        totalTreasuryUsdt: 50000,
        dailyP2pVolumeUsdt: 10000,
        p2pTurnoverDays: NOT_MEASURED,
        flexibleAprPct: 2.5,
        locked30dAprPct: 6.0,
        locked60dAprPct: 8.5,
        safetyBufferPct: 30,
      });

      expect(result.missingInputs).toEqual(['p2pTurnoverDays']);
      expect(result.flexibleBufferUsdt).toBeNull();
      expect(result.weeklyRollingLiquidityUsdt).toBeNull();
      expectNoNonFiniteNumbers(result, 'liquidity ladder w/o turnover');
    });
  });

  describe('6. calculateEarnYieldVsP2pHurdleRate', () => {
    it('declares the absence instead of assuming a 0.5h trade cycle', () => {
      const result = calculateEarnYieldVsP2pHurdleRate({
        grossP2pSpreadPct: 1.8,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: NOT_MEASURED,
        simpleEarnAprPct: 4.0,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['averageTradeCycleHours']);
      expect(result.verdict).toBe('NOT_ASSESSED');
      expect(result.annualizedP2pRoiPct).toBeNull();
      expect(result.hourlyP2pReturnPct).toBeNull();
      expect(result.isP2pProfitableOverEarn).toBeNull();
      // The old `Math.max(0.5, undefined)` produced NaN here.
      expectNoNonFiniteNumbers(result, 'hurdle rate w/o cycle hours');
    });
  });

  describe('7. modelBnbVaultYieldStacking', () => {
    it('declares the absence of the BNB price instead of flooring it at 1 USDT', () => {
      const result = modelBnbVaultYieldStacking({
        bnbAmount: 20,
        bnbPriceUsdt: NOT_MEASURED,
        simpleEarnAprPct: 1.5,
        activeLaunchpoolsCount: 1,
        averageLaunchpoolAprPct: 15.0,
        hodlerAirdropProjectedAprPct: 3.5,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['bnbPriceUsdt']);
      expect(result.totalBnbValueUsdt).toBeNull();
      expect(result.launchpoolYieldUsdt).toBeNull();
      expect(result.airdropYieldUsdt).toBeNull();
      expect(result.totalAnnualProjectedYieldUsdt).toBeNull();
      // APR is a rate: it needs no USDT price, so it stays measured.
      expect(result.stackedBlendedAprPct).toBe(20.0);
      // Simple Earn accrual is denominated in BNB, so it needs no price.
      expect(result.simpleEarnYieldBnb).toBe(0.3);
      expectNoNonFiniteNumbers(result, 'BNB vault w/o price');
    });

    it('declares the absence of the airdrop APR instead of assuming 3.5%', () => {
      const result = modelBnbVaultYieldStacking({
        bnbAmount: 20,
        bnbPriceUsdt: 600,
        simpleEarnAprPct: 1.5,
        activeLaunchpoolsCount: 1,
        averageLaunchpoolAprPct: 15.0,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['hodlerAirdropProjectedAprPct']);
      expect(result.airdropYieldUsdt).toBeNull();
      expect(result.stackedBlendedAprPct).toBeNull();
      expect(result.totalAnnualProjectedYieldUsdt).toBeNull();
      // Measured legs survive.
      expect(result.totalBnbValueUsdt).toBe(12000);
      expect(result.launchpoolYieldUsdt).toBe(1800);
    });
  });

  describe('8. forecastFlexibleEarnTierSaturation', () => {
    it('declares the absence of the per-account tier limit instead of assuming 500', () => {
      const result = forecastFlexibleEarnTierSaturation({
        totalCapitalUsdt: 2500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
        availableSubaccountsCount: 5,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['tier1LimitPerAccountUsdt']);
      expect(result.tier1UtilizedUsdt).toBeNull();
      expect(result.tier2DegradedUsdt).toBeNull();
      expect(result.singleAccountEffectiveAprPct).toBeNull();
      expect(result.multiAccountOptimizedAprPct).toBeNull();
      expect(result.potentialAnnualSurplusUsdt).toBeNull();
      expect(result.recommendedSubaccountsNeeded).toBeNull();
      expect(result.totalCapitalUsdt).toBe(2500);
    });

    it('declares the absence of the subaccount count instead of assuming 3', () => {
      const result = forecastFlexibleEarnTierSaturation({
        totalCapitalUsdt: 2500,
        tier1LimitPerAccountUsdt: 500,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['availableSubaccountsCount']);
      expect(result.multiAccountOptimizedAprPct).toBeNull();
      expect(result.potentialAnnualSurplusUsdt).toBeNull();
      // Single-account figures and the subaccount recommendation need no count.
      expect(result.tier1UtilizedUsdt).toBe(500);
      expect(result.tier2DegradedUsdt).toBe(2000);
      expect(result.recommendedSubaccountsNeeded).toBe(5);
    });
  });

  describe('9. calculateAutoInvestDcaSpreadFunnel', () => {
    it('declares the absence of the projected asset growth instead of assuming 15%', () => {
      const result = calculateAutoInvestDcaSpreadFunnel({
        monthlyP2pNetProfitUsdt: 3000,
        reinvestmentRatioPct: 25,
        targetAsset: 'BTC',
        executionFrequency: 'WEEKLY',
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['projectedAnnualAssetGrowthPct']);
      expect(result.projectedEndValueUsdt).toBeNull();
      // The funnel allocation itself rests on measured profit and ratio.
      expect(result.monthlyReinvestedUsdt).toBe(750);
      expect(result.retainedTreasuryUsdt).toBe(2250);
      expect(result.periodicInvestmentUsdt).toBe(187.5);
      expect(result.projectedYearlyAllocatedUsdt).toBe(9000);
    });
  });

  describe('10. simulateEarnInstantRedemptionLatency', () => {
    it('does not authorize an instant redemption against an unmeasured quota', () => {
      const result = simulateEarnInstantRedemptionLatency({
        redemptionAmountUsdt: 500000,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual([
        'dailyInstantQuotaUsdt',
        'dailyQuotaConsumedUsdt',
        'averageSlippageOrDelayHours',
      ]);
      expect(result.canExecuteInstant).toBeNull();
      expect(result.instantRedemptionAvailableUsdt).toBeNull();
      expect(result.standardRedemptionPendingUsdt).toBeNull();
      expect(result.estimatedSettlementDelayHours).toBeNull();
      expect(result.executionRisk).toBe('NOT_ASSESSED');
      expect(result.actionablePlan).toContain('dailyInstantQuotaUsdt');

      // The old default approved a 500k instant redemption at 100%.
      expect(JSON.stringify(result)).not.toContain('"canExecuteInstant":true');
      expect(JSON.stringify(result)).not.toContain('NEGLIGIBLE');
      // The requested amount was measured and is still reported.
      expect(result.requestedAmountUsdt).toBe(500000);
    });

    it('does not assume the daily quota was untouched', () => {
      const result = simulateEarnInstantRedemptionLatency({
        redemptionAmountUsdt: 5000,
        dailyInstantQuotaUsdt: 20000,
      });

      expect(result.missingInputs).toEqual([
        'dailyQuotaConsumedUsdt',
        'averageSlippageOrDelayHours',
      ]);
      expect(result.canExecuteInstant).toBeNull();
      expect(result.instantRedemptionAvailableUsdt).toBeNull();
      expect(result.executionRisk).toBe('NOT_ASSESSED');
    });

    it('declares the absence of the settlement delay instead of assuming 0.1h', () => {
      const result = simulateEarnInstantRedemptionLatency({
        redemptionAmountUsdt: 50000,
        dailyInstantQuotaUsdt: 20000,
        dailyQuotaConsumedUsdt: 10000,
      });

      expect(result.missingInputs).toEqual(['averageSlippageOrDelayHours']);
      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      // A deferral is certain; only its duration is unmeasured.
      expect(result.canExecuteInstant).toBe(false);
      expect(result.executionRisk).toBe('PARTIAL_DELAY');
      expect(result.estimatedSettlementDelayHours).toBeNull();
    });
  });

  describe('6. calculateEarnYieldVsP2pHurdleRate', () => {
    it('declares the absence of the Simple Earn APR instead of assuming a hurdle of 0', () => {
      // `simpleEarnAprPct` is fed by `effectiveBlendedAprPct`, which is nullable.
      // Comparing P2P against Earn with a fabricated hurdle rate is exactly the
      // kind of verdict the doctrine forbids.
      const result = calculateEarnYieldVsP2pHurdleRate({
        grossP2pSpreadPct: 1.8,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: 2,
        simpleEarnAprPct: NOT_MEASURED,
      });

      expect(result.assessmentStatus).toBe('NOT_ASSESSED');
      expect(result.missingInputs).toEqual(['simpleEarnAprPct']);
      expect(result.verdict).toBe('NOT_ASSESSED');
      expect(result.hourlyEarnYieldPct).toBeNull();
      expect(result.hurdleSpreadPct).toBeNull();
      expect(result.isP2pProfitableOverEarn).toBeNull();
      expect(result.reasoning).toContain('simpleEarnAprPct');
      // The P2P side is fully measured and still reported.
      expect(result.netP2pCycleReturnPct).toBe(1.2);
      expectNoNonFiniteNumbers(result, 'hurdle rate w/o Earn APR');
    });

    it('still declares the absence when the cycle length is the missing input', () => {
      const result = calculateEarnYieldVsP2pHurdleRate({
        grossP2pSpreadPct: 1.8,
        platformFeePct: 0.1,
        bankingRiskPremiumPct: 0.2,
        fxDevaluationRiskPct: 0.3,
        averageTradeCycleHours: NOT_MEASURED,
        simpleEarnAprPct: 4.0,
      });

      expect(result.missingInputs).toEqual(['averageTradeCycleHours']);
      expect(result.verdict).toBe('NOT_ASSESSED');
      expect(result.hourlyP2pReturnPct).toBeNull();
      // The Earn hurdle needs no cycle length, so it stays measured.
      expect(result.hourlyEarnYieldPct).not.toBeNull();
      expect(result.hurdleSpreadPct).not.toBeNull();
      expectNoNonFiniteNumbers(result, 'hurdle rate w/o cycle length');
    });
  });
});
