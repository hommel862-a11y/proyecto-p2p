/**
 * Pure money/quantity clamping (framework-agnostic).
 * Guards the decision engine from NaN / negative / over-large values that can enter
 * via number inputs or a corrupted backup. Money math must stay deterministic.
 */

/**
 * Clamp a monetary/quantity value to a non-negative finite value.
 * NaN, ±Infinity, and negatives collapse to 0; 0 and positives pass through unchanged.
 * Used to sanitize user-entered money so it can never poison PnL/PnL stats.
 */
export function clampNonNegative(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Clamp a value to a minimum floor. Non-finite values (NaN/±Infinity) become the floor.
 * Used for counts/thresholds that must be at least `floor` (e.g. at least 1 op, at least 0.1%).
 */
export function clampAtLeast(v: number, floor: number): number {
  return Number.isFinite(v) ? Math.max(v, floor) : floor;
}
