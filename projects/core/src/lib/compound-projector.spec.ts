import { describe, it, expect } from 'vitest';
import { simulateCompoundGrowth } from './compound-projector';

describe('simulateCompoundGrowth', () => {
  it('throws when initialCapitalUsdt is non-positive', () => {
    expect(() =>
      simulateCompoundGrowth({
        initialCapitalUsdt: 0,
        netMarginPctPerCycle: 1,
        cyclesPerDay: 1.5,
        operationalDays: 30,
        reinvestmentRatePct: 100,
      }),
    ).toThrowError('initialCapitalUsdt must be greater than 0');
  });

  it('calculates 100% reinvestment growth for 10k portfolio over 30 days', () => {
    const res = simulateCompoundGrowth({
      initialCapitalUsdt: 10000,
      netMarginPctPerCycle: 0.9,
      cyclesPerDay: 1.5,
      operationalDays: 30,
      reinvestmentRatePct: 100,
      referenceRateVes: 60,
    });

    expect(res.initialCapitalUsdt).toBe(10000);
    expect(res.finalWorkingCapitalUsdt).toBeGreaterThan(14000);
    expect(res.totalHarvestedUsdt).toBe(0);
    expect(res.dailyProjection.length).toBe(30);
    expect(res.milestones.day30CapitalUsdt).toBe(res.finalWorkingCapitalUsdt);
  });

  it('calculates 50/50 harvesting policy with safe dividend extraction', () => {
    const res = simulateCompoundGrowth({
      initialCapitalUsdt: 10000,
      netMarginPctPerCycle: 1.0,
      cyclesPerDay: 1.0,
      operationalDays: 30,
      reinvestmentRatePct: 50,
      referenceRateVes: 60,
    });

    expect(res.totalHarvestedUsdt).toBeGreaterThan(0);
    expect(res.finalWorkingCapitalUsdt).toBeGreaterThan(10000);
    expect(res.totalPortfolioValueUsdt).toBe(res.finalWorkingCapitalUsdt + res.totalHarvestedUsdt);
  });

  it('triggers banking capacity wall alert when daily volume exceeds limit', () => {
    const res = simulateCompoundGrowth({
      initialCapitalUsdt: 10000,
      netMarginPctPerCycle: 1.2,
      cyclesPerDay: 2.0,
      operationalDays: 30,
      reinvestmentRatePct: 100,
      dailyBankLimitVes: 1500000, // Strict limit ~ 25,000 USDT
      referenceRateVes: 60,
    });

    expect(res.bankingWallAlert).toBeDefined();
    expect(res.bankingWallAlert?.firstDayExceeded).toBe(1);
    expect(res.bankingWallAlert?.dailyVolumeAtWallVes).toBeGreaterThan(1500000);
  });
});
