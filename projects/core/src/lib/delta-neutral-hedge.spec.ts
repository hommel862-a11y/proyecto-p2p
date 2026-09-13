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
});
