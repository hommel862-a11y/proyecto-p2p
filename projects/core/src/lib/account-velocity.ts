/**
 * Pure account rotation / daily velocity domain logic (framework-agnostic).
 * Counts daily operations per bank account, maps them to a traffic-light health
 * (SUDEBAN-style per-day transaction caps) and recommends which account to
 * rotate to when an account approaches saturation.
 * No network, no Angular.
 */

import { type AccountRail, type BankAccount, computeAccountUsage } from './accounts';
import { type Operation } from './log';

/** Per-account daily transaction cap configuration for the velocity heuristic. */
export interface VelocityThresholds {
  /** Max daily outbound transfers before the account is considered saturated. */
  maxDailyTransactions: number;
}

/** Traffic-light health of an account relative to its daily transaction cap. */
export type AccountVelocityHealth = 'OPTIMAL' | 'MODERATE' | 'REST_RECOMMENDED' | 'SATURATED';

export interface AccountVelocityStatus {
  /** Stable account id (same as BankAccount.id). */
  accountId: string;
  /** Display label of the bank account. */
  bankName: string;
  /** Payment rail used for settlements. */
  rail: AccountRail;
  /** Operations attributed to this account today. */
  todayTransactionCount: number;
  /** Configured daily transaction cap. */
  maxDailyTransactions: number;
  /** Percentage of the transaction cap consumed (0 to 100+). */
  usedPct: number;
  /** Traffic-light health derived from the consumed percentage. */
  velocityHealth: AccountVelocityHealth;
  /** True when usedPct >= 75% and still below 100%. */
  isNearThreshold: boolean;
  /** True when usedPct >= 100%. */
  isAtThreshold: boolean;
  /** Recommended rest period in hours before using this account again (0 when healthy). */
  recommendedWaitHours: number;
}

const DEFAULT_VELOCITY_THRESHOLDS: VelocityThresholds = { maxDailyTransactions: 15 };

const HEALTH_RANK: Record<AccountVelocityHealth, number> = {
  OPTIMAL: 0,
  MODERATE: 1,
  REST_RECOMMENDED: 2,
  SATURATED: 3,
};

/**
 * Count the operations attributed to an account today.
 * Matching rules mirror `computeAccountUsage`: explicit `bankAccountId` first,
 * otherwise the merchantNote must contain the bank name (case-insensitive).
 */
export function countTodayTransactions(
  account: BankAccount,
  todayOps: readonly Operation[],
): number {
  return todayOps.filter(
    (op) =>
      op.bankAccountId === account.id ||
      (!op.bankAccountId && op.merchantNote?.toLowerCase().includes(account.bankName.toLowerCase())),
  ).length;
}

/**
 * Map a raw daily transaction count to a traffic-light health state.
 * Saturation at 100% of the cap, REST_RECOMMENDED from ~75% (rounded),
 * MODERATE from ~40% (rounded), otherwise OPTIMAL.
 */
export function assessVelocity(
  todayCount: number,
  maxDailyTransactions = DEFAULT_VELOCITY_THRESHOLDS.maxDailyTransactions,
): AccountVelocityHealth {
  if (todayCount >= maxDailyTransactions) return 'SATURATED';
  if (todayCount >= Math.round(maxDailyTransactions * 0.75)) return 'REST_RECOMMENDED';
  if (todayCount >= Math.round(maxDailyTransactions * 0.4)) return 'MODERATE';
  return 'OPTIMAL';
}

/**
 * Compute the full velocity status for a single bank account.
 */
export function computeAccountVelocity(
  account: BankAccount,
  todayOps: readonly Operation[],
  thresholds: VelocityThresholds = DEFAULT_VELOCITY_THRESHOLDS,
): AccountVelocityStatus {
  const max = thresholds.maxDailyTransactions;
  const count = countTodayTransactions(account, todayOps);
  const usedPct = max > 0 ? Math.round((count / max) * 100) : 0;
  const velocityHealth = assessVelocity(count, max);
  const isAtThreshold = usedPct >= 100;
  const isNearThreshold = usedPct >= 75 && !isAtThreshold;
  const recommendedWaitHours =
    velocityHealth === 'SATURATED' ? 24 : velocityHealth === 'REST_RECOMMENDED' ? 4 : 0;

  return {
    accountId: account.id,
    bankName: account.bankName,
    rail: account.rail,
    todayTransactionCount: count,
    maxDailyTransactions: max,
    usedPct,
    velocityHealth,
    isNearThreshold,
    isAtThreshold,
    recommendedWaitHours,
  };
}

/**
 * Compute velocity status for every configured account.
 */
export function computeVelocities(
  accounts: readonly BankAccount[],
  todayOps: readonly Operation[],
  thresholds?: VelocityThresholds,
): AccountVelocityStatus[] {
  return accounts.map((acc) => computeAccountVelocity(acc, todayOps, thresholds));
}

/**
 * Recommend the best account to route the next trade to when SUDEBAN-style daily
 * transaction caps matter. Excludes saturated (transaction cap reached) and
 * over-limit (VES cap reached) accounts, requires enough remaining daily VES
 * limit for `requiredVes`, then prioritizes the healthiest velocity state,
 * tie-broken by the largest remaining VES limit.
 */
export function getRotationRecommendation(
  accounts: readonly BankAccount[],
  todayOps: readonly Operation[],
  requiredVes?: number,
  thresholds?: VelocityThresholds,
): BankAccount | null {
  const need = requiredVes ?? 0;

  let best: { account: BankAccount; remainingLimitVes: number; healthRank: number } | null = null;

  for (const acc of accounts) {
    const usage = computeAccountUsage(acc, todayOps);

    // Skip accounts whose daily VES cap is exhausted.
    if (usage.isOverLimit) continue;
    // Skip accounts that cannot cover the requested amount.
    if (acc.dailyLimitVes > 0 && usage.remainingLimitVes < need) continue;

    const velocity = computeAccountVelocity(acc, todayOps, thresholds);
    // Skip accounts at the daily transaction cap.
    if (velocity.velocityHealth === 'SATURATED') continue;

    const healthRank = HEALTH_RANK[velocity.velocityHealth];
    if (
      !best ||
      healthRank < best.healthRank ||
      (healthRank === best.healthRank && usage.remainingLimitVes > best.remainingLimitVes)
    ) {
      best = { account: acc, remainingLimitVes: usage.remainingLimitVes, healthRank };
    }
  }

  return best?.account ?? null;
}