import { describe, it, expect } from 'vitest';
import { computeDynamicOrderLimits, buildPortfolioAllocationPlan } from './capital-allocator';

describe('computeDynamicOrderLimits', () => {
  it('calculates morning liquidity limits with anti-pitufeo floor', () => {
    const limits = computeDynamicOrderLimits(10000, 10, 60);
    expect(limits.capitalUsdt).toBe(10000);
    expect(limits.minTicketUsdt).toBeGreaterThanOrEqual(150);
    expect(limits.maxTicketUsdt).toBeLessThanOrEqual(2500);
    expect(limits.regime).toBe('MORNING_LIQUIDITY');
  });

  it('adjusts limits for midday volatility window', () => {
    const limits = computeDynamicOrderLimits(10000, 13, 60);
    expect(limits.regime).toBe('MIDDAY_VOLATILITY');
    expect(limits.maxTicketUsdt).toBeLessThanOrEqual(1500);
  });
});

describe('buildPortfolioAllocationPlan', () => {
  it('allocates 10k capital into Banesco 40%, Mercantil 35% and BDV 25%', () => {
    const plan = buildPortfolioAllocationPlan(10000, [], 60, 10);
    expect(plan.totalCapitalUsdt).toBe(10000);
    expect(plan.allocations.length).toBe(3);

    const banesco = plan.allocations.find((a) => a.bankCode === 'BANESCO');
    const mercantil = plan.allocations.find((a) => a.bankCode === 'MERCANTIL');
    const bdv = plan.allocations.find((a) => a.bankCode === 'BDV');

    expect(banesco?.allocatedCapitalUsdt).toBe(4000);
    expect(mercantil?.allocatedCapitalUsdt).toBe(3500);
    expect(bdv?.allocatedCapitalUsdt).toBe(2500);
  });
});
