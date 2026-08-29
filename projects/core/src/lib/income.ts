/**
 * Pure income-target -> required-capital math (framework-agnostic).
 * CORRECT formula: annual = target * days; capital = annual / APR.
 * Replaces the discarded 10x error.
 */

export interface CapitalResult {
  /** annual income in USD = targetUsd * days */
  annual: number;
  /** required capital in USD = annual / APR */
  capital: number;
}

/** Default year basis for the income calculation. Design decision: 365 days. */
export const DEFAULT_DAYS_PER_YEAR = 365;

export function capitalFromDailyIncome(
  targetUsd: number,
  apr: number,
  days: number = DEFAULT_DAYS_PER_YEAR,
): CapitalResult {
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
    throw new Error('targetUsd must be a positive number');
  }
  if (!Number.isFinite(apr) || apr <= 0) {
    throw new Error('apr must be a positive number');
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('days must be a positive number');
  }
  const annual = targetUsd * days;
  const capital = annual / apr;
  return { annual, capital };
}

/** Convert a USD amount to Venezuelan bolivars using a user-supplied VES/USDT rate. */
export function toBs(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(rate)) {
    throw new Error('usd and rate must be finite numbers');
  }
  return usd * rate;
}
