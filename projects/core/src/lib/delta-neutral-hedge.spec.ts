import { describe, it, expect } from 'vitest';
import {
  calculatePortfolioDelta,
  evaluateDeltaHedge,
  authorizeHedgeProposal,
  type PortfolioBalanceSnapshot,
} from './delta-neutral-hedge';

describe('Delta-Neutral Hedge Engine (Human-in-the-Loop)', () => {
  it('computes portfolio delta and risk score accurately', () => {
    // 5,000 USDT and 10,000 VES at 50.0 VES/USD = $200 in VES, $5,000 in USDT = total $5,200
    // Fiat ratio = 200 / 5200 = 3.8%
    const balancedSnapshot: PortfolioBalanceSnapshot = {
      usdtBalance: 5000,
      vesBalance: 10000,
      currentParallelRate: 50.0,
      openP2pSellOrdersUsdt: 0,
      openP2pBuyOrdersVes: 0,
      vesMaxHoldingTimeMinutes: 10,
    };

    const delta = calculatePortfolioDelta(balancedSnapshot);
    expect(delta.totalEquityUsd).toBe(5200);
    expect(delta.fiatExposureUsd).toBe(200);
    expect(delta.netDeltaRatio).toBeLessThan(0.05);
    expect(delta.urgency).toBe('NONE');
  });

  it('detects high unhedged fiat exposure and generates proposal with Human-in-the-Loop signature', () => {
    // 1,000 USDT and 100,000 VES at 50.0 VES/USD = $2,000 in VES, $1,000 in USDT = total $3,000
    // Fiat ratio = 2000 / 3000 = 66.6% (way above 15% threshold)
    const exposedSnapshot: PortfolioBalanceSnapshot = {
      usdtBalance: 1000,
      vesBalance: 100000,
      currentParallelRate: 50.0,
      openP2pSellOrdersUsdt: 0,
      openP2pBuyOrdersVes: 0,
      vesMaxHoldingTimeMinutes: 45,
    };

    const delta = calculatePortfolioDelta(exposedSnapshot);
    expect(delta.netDeltaRatio).toBeGreaterThan(0.5);
    expect(delta.urgency).toBe('HIGH');

    const proposal = evaluateDeltaHedge(exposedSnapshot);
    expect(proposal).not.toBeNull();
    expect(proposal?.requiresHumanSignature).toBe(true);
    expect(proposal?.state).toBe('PROPOSED');
    expect(proposal?.hedgeAmountUsdt).toBeGreaterThan(1000);
  });

  it('rejects blind execution and strictly authorizes proposal only with human operator signature', () => {
    const exposedSnapshot: PortfolioBalanceSnapshot = {
      usdtBalance: 1000,
      vesBalance: 100000,
      currentParallelRate: 50.0,
      openP2pSellOrdersUsdt: 0,
      openP2pBuyOrdersVes: 0,
      vesMaxHoldingTimeMinutes: 45,
    };

    const proposal = evaluateDeltaHedge(exposedSnapshot)!;

    // Fail on empty operator signature
    const failedAuth = authorizeHedgeProposal(proposal, '');
    expect(failedAuth.success).toBe(false);
    expect(failedAuth.updatedProposal.state).toBe('PROPOSED');

    // Succeed on valid operator signature
    const validAuth = authorizeHedgeProposal(proposal, 'OPERATOR_ALICE');
    expect(validAuth.success).toBe(true);
    expect(validAuth.updatedProposal.state).toBe('APPROVED_BY_OPERATOR');
  });

  describe('Phase 1: Convexity, Funding Arbitrage & Kelly Allocation', () => {
    it('calculateConvexityAndGammaRisk flags exponential collapse on severe devaluation jump', async () => {
      const { calculateConvexityAndGammaRisk } = await import('./delta-neutral-hedge');
      const res = calculateConvexityAndGammaRisk({
        spotParallelRate: 80.0,
        vesHoldingAmount: 400000, // $5,000 USDT inicial
        expectedDevaluationJumpPct: 30, // 30% jump
        timeHorizonDays: 3,
      });

      expect(res.linearLossUsdt).toBeGreaterThan(1100);
      expect(res.acceleratedGammaLossUsdt).toBeGreaterThan(0);
      expect(res.riskSeverity).toBe('EXPONENTIAL_COLLAPSE');
      expect(res.actionableDirective).toContain('EMERGENCIA');
    });

    it('modelPerpetualFundingArbitrage computes positive APY and income on attractive funding', async () => {
      const { modelPerpetualFundingArbitrage } = await import('./delta-neutral-hedge');
      const res = modelPerpetualFundingArbitrage({
        collateralUsdt: 10000,
        currentFundingRate8hPct: 0.02, // 0.06% diario = 21.9% anual
        annualizedBorrowRateUsdtPct: 5.0,
        holdingPeriodDays: 14,
      });

      expect(res.annualizedApyPct).toBeGreaterThan(20);
      expect(res.isFundingAttractive).toBe(true);
      expect(res.netYieldAfterBorrowCostUsdt).toBeGreaterThan(0);
    });

    it('optimizeCapitalAllocationKelly calculates optimal ticket and bank allocations', async () => {
      const { optimizeCapitalAllocationKelly } = await import('./delta-neutral-hedge');
      const res = optimizeCapitalAllocationKelly({
        totalCapitalUsdt: 12000,
        winRatePct: 80,
        averageProfitPerWinUsdt: 50,
        averageLossPerLossUsdt: 20,
        fractionalSafetyMultiplier: 0.33,
        maxBankConcentrationPct: 25,
      });

      expect(res.fullKellyFractionPct).toBeGreaterThan(60);
      expect(res.recommendedFractionPct).toBeGreaterThan(15);
      expect(res.optimalTicketSizeUsdt).toBeGreaterThan(1000);
      expect(res.allocationByBankUsdt.length).toBe(4);
      expect(res.allocationByBankUsdt[0].maxAllocationUsdt).toBe(3000);
    });
  });
});

