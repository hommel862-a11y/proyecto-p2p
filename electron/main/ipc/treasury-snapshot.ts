/**
 * In-memory cache of the treasury projection announced by the renderer.
 *
 * Bank accounts only exist in the renderer's localStorage (`p2p.bank-accounts`), so the
 * main process has no other source of truth for daily limits or account health. The
 * renderer pushes a plain `TreasurySnapshotDto` through the `p2p:treasury-announce`
 * channel and the swarm reads it back before auditing any proposal.
 *
 * This module has no runtime imports on purpose (the DTO import is type-only, so it is
 * erased at compile time). `ipc/handlers.ts` already imports `agents/swarm-orchestrator`,
 * so putting the shared state in handlers.ts would make the orchestrator import its own
 * consumer and create a cycle. Both sides depend on this leaf module instead.
 */

import type { TreasurySnapshotDto } from '../../shared/types';

/**
 * Numeric aggregates the Risk Gatekeeper performs arithmetic or comparisons on. A payload
 * missing any of them is rejected instead of being coerced, so a malformed announce can
 * never turn into NaN comparisons or a silently empty treasury.
 */
const REQUIRED_NUMERIC_FIELDS: readonly (keyof TreasurySnapshotDto)[] = [
  'totalSpentTodayVes',
  'totalDailyLimitVes',
  'nearLimitCount',
  'overLimitCount',
  'disabledCount',
  'saturatedCount',
];

let latestSnapshot: TreasurySnapshotDto | null = null;

function isUsableSnapshot(snapshot: unknown): snapshot is TreasurySnapshotDto {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const candidate = snapshot as Record<string, unknown>;
  return REQUIRED_NUMERIC_FIELDS.every((field) => {
    const value = candidate[field];
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/**
 * Cache the latest renderer snapshot. Returns false and keeps the previous snapshot when
 * the payload does not satisfy the numeric contract.
 */
export function setTreasurySnapshot(snapshot: unknown): boolean {
  if (!isUsableSnapshot(snapshot)) {
    console.warn('[Treasury] Rejected malformed treasury snapshot announced by the renderer.');
    return false;
  }
  latestSnapshot = snapshot;
  return true;
}

/** Latest announced snapshot, or null when the renderer never announced one. */
export function getTreasurySnapshot(): TreasurySnapshotDto | null {
  return latestSnapshot;
}

/** Drop the cached snapshot (renderer reload, account removal, tests). */
export function clearTreasurySnapshot(): void {
  latestSnapshot = null;
}
