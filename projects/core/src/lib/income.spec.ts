import { describe, it, expect } from 'vitest';
import { capitalFromDailyIncome, toBs } from './income';

describe('capitalFromDailyIncome', () => {
  it('RESOLVED 365-day basis: $20/day @10% -> annual 7300, capital 73000', () => {
    const r = capitalFromDailyIncome(20, 0.1);
    expect(r.annual).toBe(7300);
    expect(r.capital).toBe(73000);
  });

  it('honors an explicit days parameter (360 -> 7200 / 72000)', () => {
    const r = capitalFromDailyIncome(20, 0.1, 360);
    expect(r.annual).toBe(7200);
    expect(r.capital).toBe(72000);
  });

  it('table cells (365-day): 1/day@8%=4562.50; 5/day@10%=18250; 20/day@15%=48666.67', () => {
    expect(capitalFromDailyIncome(1, 0.08).capital).toBe(4562.5);
    expect(capitalFromDailyIncome(5, 0.1).capital).toBe(18250);
    expect(capitalFromDailyIncome(20, 0.15).capital).toBeCloseTo(48666.67, 2);
  });

  it('uses CORRECT math (annual/APR), never the 10x error', () => {
    const r = capitalFromDailyIncome(20, 0.1);
    expect(r.capital).toBe(73000);
    expect(r.capital).not.toBe(730000);
  });

  it('rejects negative or zero target/APR', () => {
    expect(() => capitalFromDailyIncome(-1, 0.1)).toThrow(/positive/i);
    expect(() => capitalFromDailyIncome(0, 0.1)).toThrow(/positive/i);
    expect(() => capitalFromDailyIncome(20, 0)).toThrow(/positive/i);
  });
});

describe('toBs', () => {
  it('converts USD capital to Bs via the supplied VES/USDT rate', () => {
    expect(toBs(73000, 800)).toBe(58400000);
  });
});
