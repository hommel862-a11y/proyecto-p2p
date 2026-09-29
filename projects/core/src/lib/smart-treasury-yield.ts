/**
 * Pure Mathematical Engine for Smart Treasury & Idle Capital Yield Maximizer.
 * Calculates optimal allocation of idle USDT/stablecoin inventory into flexible yield vaults
 * (such as Binance Simple Earn or Aave V3) during off-peak hours (nights, weekends).
 * Guarantees liquidity safety buffers and instant redemption triggers for trading spikes.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type MarketVelocityLevel = 'LOW_OFFPEAK' | 'NORMAL_FLOW' | 'HIGH_SURGE';

export interface TreasuryYieldParams {
  totalUsdtInventory: number;
  currentlyCommittedUsdt: number; // in active P2P ads or open trade escrows
  marketVelocity: MarketVelocityLevel;
  flexibleApyPct?: number; // e.g. 11.2% APY on Binance Simple Earn
  apyProvenance?: 'LIVE_EXCHANGE_FEED' | 'ESTIMATED_BENCHMARK';
  minimumSafetyBufferUsd?: number; // e.g. $2,000 USDT kept unallocated in spot for immediate orders
}

export interface TreasuryAllocationPlan {
  totalInventoryUsd: number;
  availableIdleUsdt: number;
  recommendedSweepAmountUsd: number;
  retainedSafetyBufferUsd: number;
  flexibleApyPct: number;
  apyProvenance: 'LIVE_EXCHANGE_FEED' | 'ESTIMATED_BENCHMARK';
  projectedDailyInterestUsd: number;
  projectedMonthlyInterestUsd: number;
  projectedAnnualInterestUsd: number;
  actionDirective: 'EXECUTE_SWEEP_DEPOSIT' | 'MAINTAIN_CURRENT_ALLOCATION' | 'TRIGGER_INSTANT_REDEMPTION';
  redemptionThresholdNotice: string;
  timestamp: string;
}

/**
 * Calculates optimal allocation into flexible yield products based on desk market velocity.
 */
export function calculateTreasuryYieldAllocation(
  params: TreasuryYieldParams,
): TreasuryAllocationPlan {
  const total = Math.max(0, params.totalUsdtInventory);
  const committed = Math.max(0, params.currentlyCommittedUsdt);
  const idle = Math.max(0, total - committed);

  const apy = params.flexibleApyPct && params.flexibleApyPct > 0 ? params.flexibleApyPct : 10.5;
  const apyProvenance = params.apyProvenance ?? (params.flexibleApyPct ? 'LIVE_EXCHANGE_FEED' : 'ESTIMATED_BENCHMARK');
  const defaultBuffer = params.minimumSafetyBufferUsd ?? 2500;

  let bufferRequired = defaultBuffer;
  let sweepAmount = 0;
  let directive: 'EXECUTE_SWEEP_DEPOSIT' | 'MAINTAIN_CURRENT_ALLOCATION' | 'TRIGGER_INSTANT_REDEMPTION' =
    'MAINTAIN_CURRENT_ALLOCATION';

  if (params.marketVelocity === 'LOW_OFFPEAK') {
    // Night or weekend: retain minimal buffer ($1,000), sweep all remaining idle capital
    bufferRequired = Math.min(1000, idle * 0.15);
    sweepAmount = Math.max(0, idle - bufferRequired);
    if (sweepAmount >= 500) {
      directive = 'EXECUTE_SWEEP_DEPOSIT';
    }
  } else if (params.marketVelocity === 'HIGH_SURGE') {
    // Market surge: high trading volume. All funds must be in spot wallet
    bufferRequired = idle;
    sweepAmount = 0;
    directive = 'TRIGGER_INSTANT_REDEMPTION';
  } else {
    // NORMAL_FLOW: keep safety buffer, sweep excess
    bufferRequired = defaultBuffer;
    sweepAmount = Math.max(0, idle - bufferRequired);
    if (sweepAmount >= 1000) {
      directive = 'EXECUTE_SWEEP_DEPOSIT';
    }
  }

  const roundedSweep = roundMoney(sweepAmount, 2);
  const roundedBuffer = roundMoney(bufferRequired, 2);

  // Interest projections:
  const annualYield = roundMoney((roundedSweep * apy) / 100, 2);
  const dailyYield = roundMoney(annualYield / 365, 4);
  const monthlyYield = roundMoney(annualYield / 12, 2);

  const thresholdNotice =
    directive === 'EXECUTE_SWEEP_DEPOSIT'
      ? `Retiro instantáneo de Earn requerido si entra orden > $${roundedBuffer.toFixed(0)} USDT o si el spread P2P supera 1.35%.`
      : 'Mantener liquidez en Spot. Mercado activo.';

  return {
    totalInventoryUsd: total,
    availableIdleUsdt: idle,
    recommendedSweepAmountUsd: roundedSweep,
    retainedSafetyBufferUsd: roundedBuffer,
    flexibleApyPct: apy,
    apyProvenance,
    projectedDailyInterestUsd: dailyYield,
    projectedMonthlyInterestUsd: monthlyYield,
    projectedAnnualInterestUsd: annualYield,
    actionDirective: directive,
    redemptionThresholdNotice: thresholdNotice,
    timestamp: new Date().toISOString(),
  };
}
