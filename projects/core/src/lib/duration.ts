/**
 * Pure duration formatting (framework-agnostic).
 * Shared so features that render operation/session timers use one implementation
 * instead of copy-pasting identical helpers.
 */

/**
 * Format a duration in milliseconds as a compact `Xh Ym` / `Ym` string.
 * Zero, negative, or non-finite input renders as `0m`. Matches the canonical
 * dashboard/stats helper so call-site swaps are behavior-identical.
 */
export function formatDuration(durationMs: number): string {
  const ms = Number.isFinite(durationMs) ? durationMs : 0;
  if (ms <= 0) return '0m';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
