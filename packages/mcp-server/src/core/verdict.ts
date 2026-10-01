/**
 * Shared fail-closed contract for compliance verdicts.
 *
 * Five MCP tools shipped hardcoded verdicts: `sanctionedMatch` derived from a
 * substring match on the address, `trustScore: 96` for anyone not ending in
 * `0000`, `taintPercentage: 0.2` for any hash not ending in `000`, every bank
 * `OPERATIONAL`, and a `resolutionProbabilityPct: 98.4` for disputes with no
 * evidence behind them. None of those had a data source. They were not
 * simulations that declared themselves simulations — they were fabricated
 * findings wearing the authority of a screening tool.
 *
 * A compliance verdict is only actionable when it is grounded in a real feed
 * with provenance. Everything else is `UNVERIFIED` and `actionable: false`.
 *
 * The third state matters: `false` is itself a verdict. "This address is not
 * sanctioned" clears a transfer just as firmly as "this address is sanctioned"
 * blocks one, and only one of those two can be asserted without the sanctions
 * feed. So these fields are nullable and the honest answer is `null`.
 */

/** Whether a verdict can be relied upon for an automated decision. */
export type ActionableVerdict = 'MATCH' | 'CLEAR_AS_OF' | 'UNVERIFIED' | 'STALE';

/** Field state for a screen that could not reach its authoritative source. */
export type UnverifiedReason =
  | 'NO_LIVE_SANCTIONS_FEED'
  | 'NO_ONCHAIN_FORENSIC_SOURCE'
  | 'NO_BANK_TELEMETRY'
  | 'NO_COUNTERPARTY_LEDGER'
  | 'NO_EVIDENCE_ATTACHMENT';

export interface VerdictProvenance {
  /** Which source produced the verdict. `null` when no source was reached. */
  readonly source: string | null;
  /** ISO timestamp of the observation backing the verdict. */
  readonly observedAt: string | null;
  /** Identifier of the concrete record (feed release, ledger row, report). */
  readonly sourceRef: string | null;
}

/**
 * Builds the envelope every unverified screen returns.
 *
 * `actionable: false` is the load-bearing field: callers must branch on it
 * before reading any risk field, because every risk field is `null` here.
 */
export function unverifiedVerdict<T extends Record<string, unknown>>(
  payload: T,
  reason: UnverifiedReason,
  expectedSource: string,
): T & {
  verdict: 'UNVERIFIED';
  verdictReason: UnverifiedReason;
  expectedSource: string;
  provenance: VerdictProvenance;
  actionable: false;
} {
  return {
    ...payload,
    verdict: 'UNVERIFIED',
    verdictReason: reason,
    expectedSource,
    provenance: { source: null, observedAt: null, sourceRef: null },
    actionable: false,
  };
}

/** Fields every screening tool must emit as `null` when unverified. */
export const UNVERIFIED_NUMERIC_FIELDS = [
  'riskScore',
  'trustScore',
  'taintPercentage',
  'settlementLatencyMinutes',
  'averageSettlementLatencyMinutes',
  'resolutionProbabilityPct',
] as const;

/** Fields every screening tool must emit as `null` when unverified. */
export const UNVERIFIED_BOOLEAN_FIELDS = [
  'sanctionedMatch',
  'isBlacklisted',
  'isClean',
  'compliancePass',
  'directHopToMixer',
  'pauseTradingDirective',
] as const;

/** Fields every screening tool must emit as `null` when unverified. */
export const UNVERIFIED_LABEL_FIELDS = [
  'riskLevel',
  'recommendation',
  'clusterAttribution',
  'networkStatus',
  'operationalSummary',
] as const;