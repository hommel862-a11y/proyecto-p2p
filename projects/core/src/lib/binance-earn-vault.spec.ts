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

    it('handles zero capital gracefully', () => {
      const result = optimizeIdleCapitalSimpleEarn({
        capitalUsdt: 0,
        tier1AprPct: 10.0,
        tier2AprPct: 2.0,
      });
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

    it('maintains equilibrium when rates are close', () => {
      const result = calculateUsdtFdusdYieldArbitrage({
        usdtBalance: 5000,
        fdusdBalance: 5000,
        usdtFlexibleAprPct: 3.0,
        fdusdFlexibleAprPct: 3.2,
      });

      expect(result.optimalSwapDirection).toBe('MAINTAIN_EQUILIBRIUM');
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
      expect(result.flexibleBufferUsdt).toBeGreaterThanOrEqual(19500); // 10000 * 1.5 * 1.3
      expect(result.locked30dUsdt + result.locked60dUsdt).toBeCloseTo(
        result.totalTreasuryUsdt - result.flexibleBufferUsdt,
        1
      );
      expect(result.blendedPortfolioAprPct).toBeGreaterThan(result.flexibleBufferUsdt > 0 ? 2.5 : 0);
      expect(result.liquidityCoverageRatio).toBeGreaterThan(1.0);
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
