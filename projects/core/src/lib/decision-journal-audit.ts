/**
 * Decision Journal self-audit.
 *
 * The three questions the design doc asks the journal to answer, in the shapes a
 * dashboard or a report can consume directly:
 *
 *  1. How far does the modeled spread land from the realized spread, per side?
 *     Expressed as medians, because a mean is dominated by the worst trade and the
 *     question is "what does a typical decision look like".
 *  2. How much of what the engine decided is actually verifiable?
 *  3. How much of it was decided on data the engine already knew was stale?
 *
 * Everything here is pure: it folds rows the port already produced. No storage,
 * no SQL, no framework. The application facade wires the reads; this file owns
 * the arithmetic, so the same numbers come out of any adapter.
 *
 * **On the word "verified".** `decisionsWithRecordedAttempt` counts decisions that
 * have at least one outcome row — a publication attempt, successful or not. It is
 * *not* a count of filled trades, and it never was. A failed attempt proves the
 * engine tried; it proves nothing about money. The name carries that meaning on
 * purpose: renaming it to "verified" is what let a publish attempt pass for a fill
 * in the first place.
 */

import type {
  DecisionPerformanceRow,
  DecisionSide,
  VerificationSummary,
} from './decision-journal';

/** The sides the journal ever records, in a stable order. */
const SIDES: readonly DecisionSide[] = ['BUY', 'SELL'];

/** Modeled vs realized spread for one side. */
export interface SideSpreadAudit {
  readonly side: DecisionSide;
  /** Decisions on this side inside the filter. */
  readonly decisions: number;
  /** Median of `modeledSpreadPct`; null when there are no decisions. */
  readonly medianModeledSpreadPct: number | null;
  /**
   * Median of the spreads this side actually reported; null when no decision on
   * this side reported one. Decisions with no reported spread are excluded from
   * the median instead of counting as 0%.
   */
  readonly medianRealizedSpreadPct: number | null;
  /** How many decisions on this side reported a realized spread. */
  readonly decisionsWithReportedSpread: number;
}

/** How much of the engine's work is backed by a recorded execution attempt. */
export interface VerificationAudit {
  readonly totalDecisions: number;
  /**
   * Decisions with at least one recorded outcome. This is a publication attempt,
   * not a fill: see the module doc.
   */
  readonly decisionsWithRecordedAttempt: number;
  /** `decisionsWithRecordedAttempt / totalDecisions`; 0 when there are no decisions. */
  readonly recordedAttemptRate: number;
  /** Decisions still waiting for their first outcome. */
  readonly decisionsAwaitingOutcome: number;
  readonly openCycles: number;
}

/** How much of the engine's work was taken on data it already flagged as stale. */
export interface StaleExposureAudit {
  readonly totalDecisions: number;
  readonly decisionsOnStaleMarket: number;
  /** `decisionsOnStaleMarket / totalDecisions`; 0 when there are no decisions. */
  readonly staleRate: number;
}

export interface DecisionSelfAudit {
  /** Always one entry per side, in `BUY`, `SELL` order, even with zero decisions. */
  readonly sides: readonly SideSpreadAudit[];
  readonly verification: VerificationAudit;
  readonly staleExposure: StaleExposureAudit;
}

/**
 * Median of a numeric list: the middle value for an odd count, the mean of the two
 * middle values for an even count. Returns null for an empty list so "no data" is
 * never rendered as 0%.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function sideAudit(side: DecisionSide, rows: readonly DecisionPerformanceRow[]): SideSpreadAudit {
  const ofSide = rows.filter((row) => row.side === side);
  const realized = ofSide
    .map((row) => row.realizedSpreadPct)
    .filter((value): value is number => value !== null);

  return {
    side,
    decisions: ofSide.length,
    medianModeledSpreadPct: median(ofSide.map((row) => row.modeledSpreadPct)),
    medianRealizedSpreadPct: median(realized),
    decisionsWithReportedSpread: realized.length,
  };
}

/**
 * Builds the self-audit from one `getDecisionPerformance` result and the
 * `getVerificationSummary` of the *same* filter.
 *
 * The medians are computed here because the read model has no notion of a median;
 * the counts are taken from the summary because the port already defines them once
 * and both adapters agree on that definition. Recomputing the counts from the rows
 * would create a second definition of "verified" that can silently drift from the
 * one the verification screen uses, so the two inputs must describe the same set —
 * enforced below.
 */
export function buildDecisionSelfAudit(
  rows: readonly DecisionPerformanceRow[],
  verification: VerificationSummary,
): DecisionSelfAudit {
  if (rows.length !== verification.totalDecisions) {
    throw new Error(
      `DecisionSelfAudit received ${rows.length} rows but a summary of ${verification.totalDecisions} decisions; ` +
        'both must come from the same DecisionPerformanceFilter.',
    );
  }

  return {
    sides: SIDES.map((side) => sideAudit(side, rows)),
    verification: {
      totalDecisions: verification.totalDecisions,
      decisionsWithRecordedAttempt: verification.verifiedDecisions,
      recordedAttemptRate: verification.verificationRate,
      decisionsAwaitingOutcome: verification.decisionsAwaitingOutcome,
      openCycles: verification.openCycles,
    },
    staleExposure: {
      totalDecisions: verification.totalDecisions,
      decisionsOnStaleMarket: verification.staleDecisions,
      staleRate: verification.staleRate,
    },
  };
}
