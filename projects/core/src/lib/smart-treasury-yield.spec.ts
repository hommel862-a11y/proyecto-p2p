import { describe, it, expect } from 'vitest';
import {
  calculateTreasuryYieldAllocation,
  type TreasuryYieldParams,
} from './smart-treasury-yield';

describe('SmartTreasuryYield Engine', () => {
  it('recommends sweeping idle funds during off-peak night hours', () => {
    const params: TreasuryYieldParams = {
      totalUsdtInventory: 40000,
      currentlyCommittedUsdt: 5000, // 35k idle
      marketVelocity: 'LOW_OFFPEAK',
      flexibleApyPct: 12.0,
    };

    const plan = calculateTreasuryYieldAllocation(params);
    expect(plan.actionDirective).toBe('EXECUTE_SWEEP_DEPOSIT');
    expect(plan.recommendedSweepAmountUsd).toBeGreaterThan(30000);
    expect(plan.projectedDailyInterestUsd).toBeGreaterThan(10);
    expect(plan.projectedAnnualInterestUsd).toBeGreaterThan(4000);
  });

  it('triggers immediate redemption when market velocity surges', () => {
    const params: TreasuryYieldParams = {
      totalUsdtInventory: 50000,
      currentlyCommittedUsdt: 20000,
      marketVelocity: 'HIGH_SURGE',
    };

    const plan = calculateTreasuryYieldAllocation(params);
    expect(plan.actionDirective).toBe('TRIGGER_INSTANT_REDEMPTION');
    expect(plan.recommendedSweepAmountUsd).toBe(0);
  });
});
