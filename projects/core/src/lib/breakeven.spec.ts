import { describe, it, expect } from 'vitest';
import { calculateBreakEven } from './breakeven';

describe('calculateBreakEven', () => {
  it('handles zero or negative inputs gracefully', () => {
    const res = calculateBreakEven({ buyPrice: 0, amount: 0 });
    expect(res.breakEvenPrice).toBe(0);
    expect(res.totalCostVes).toBe(0);
  });

  it('calculates exact break-even with zero commissions and zero bank fees', () => {
    // Bought 100 USDT @ 800 Bs/USDT with 0 fees -> Cost = 80,000 Bs
    // Break-even price should be exactly 800 Bs/USDT
    const res = calculateBreakEven({
      buyPrice: 800,
      amount: 100,
      buyFeeRate: 0,
      sellFeeRate: 0,
      fixedBankFeesVes: 0,
    });

    expect(res.totalCostVes).toBe(80000);
    expect(res.breakEvenPrice).toBe(800);
    expect(res.breakEvenSpread).toBe(0);
  });

  it('accounts for sell commission (e.g. 0.2% maker fee)', () => {
    // Bought 100 USDT @ 800 Bs = 80,000 Bs
    // Selling fee = 0.2% (0.002)
    // To get 80,000 net after 0.2% fee: 80,000 / (100 * 0.998) = 801.6032 -> 801.60 Bs
    const res = calculateBreakEven({
      buyPrice: 800,
      amount: 100,
      sellFeeRate: 0.002,
    });

    expect(res.breakEvenPrice).toBe(801.6);
    expect(res.breakEvenSpread).toBe(1.6);
  });

  it('accounts for fixed bank transfer costs', () => {
    // Bought 100 USDT @ 800 Bs = 80,000 Bs + 40 Bs bank transfer = 80,040 Bs
    // Break-even with 0 sell fee: 80,040 / 100 = 800.40 Bs
    const res = calculateBreakEven({
      buyPrice: 800,
      amount: 100,
      fixedBankFeesVes: 40,
    });

    expect(res.totalCostVes).toBe(80040);
    expect(res.breakEvenPrice).toBe(800.4);
    expect(res.breakEvenSpread).toBe(0.4);
  });

  it('calculates optimal maker ad price for target net ROI', () => {
    // 100 USDT @ 800 Bs = 80,000 Bs
    // Target ROI: 2% net -> Target profit = 1,600 Bs
    // Total revenue needed = 81,600 Bs
    // If sellFeeRate = 0: Target sell price = 816.00 Bs
    const res = calculateBreakEven({
      buyPrice: 800,
      amount: 100,
      targetRoiPct: 2,
    });

    expect(res.targetSellPrice).toBe(816);
    expect(res.targetSpread).toBe(16);
    expect(res.projectedNetProfitVes).toBe(1600);
    expect(res.safetyMarginVes).toBe(16);
  });
});
