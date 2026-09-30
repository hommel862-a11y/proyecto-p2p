/**
 * Decision Journal Port (Hexagonal Architecture).
 *
 * `DecisionJournalRepository` is the only way application services reach the
 * journal. It is a pure interface: no framework, no storage, no SQL, so the
 * SQLite adapter in Electron and the in-memory adapter below implement exactly
 * the same contract.
 *
 * Contract rules every adapter MUST honour:
 *
 *  - **Identity and time are assigned by the repository.** Inputs carry no `id`
 *    and no timestamps, so nobody can forge identity or backdate an append-only
 *    row. Ids are monotonic per table, starting at 1.
 *  - **Referential integrity is enforced on write.** A decision must point at an
 *    existing cycle and an existing snapshot; an outcome must point at an
 *    existing decision. Violations reject with an `Error`.
 *  - **Only `decision_cycles` is mutable**, through `closeCycle`, and that single
 *    mutation is one-way. `closeCycle` accepts a terminal status by allow-list
 *    (`CLOSED` | `ABANDONED`), never `OPEN`; a cycle that already reached one of
 *    them can never be closed again, so its realized figures are written once and
 *    never restated. Conversely `appendDecision` only accepts an `OPEN` cycle, so
 *    a closed cycle cannot grow after the figures that describe it were frozen.
 *    There is deliberately no `updateDecision` / `deleteOutcome` in this port.
 *    Both halves are enforced at runtime, not only by the types: the raw port is
 *    reachable from IPC, where `CloseDecisionCycleInput` is just an `unknown`.
 *  - **`observed*` fields are copied from the referenced snapshot**, never taken
 *    from the caller, so a decision cannot contradict its own market evidence.
 *  - **Reads never hand out internal references.** Every returned record is a
 *    copy, so callers cannot mutate the journal by accident.
 */

import type {
  CloseDecisionCycleInput,
  DecisionCycle,
  DecisionCycleCloseStatus,
  DecisionCycleStatus,
  DecisionOrigin,
  DecisionOutcome,
  DecisionPerformanceRow,
  DecisionSide,
  MarketSnapshot,
  OpenDecisionCycleInput,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
  RepricerDecisionRecord,
  RepricerExecutionMode,
  VerificationSummary,
} from './decision-journal';
import { VERIFIABLE_DECISION_ACTIONS } from './decision-journal';

/** Filter for `listCycles`. */
export interface DecisionCyclesFilter {
  readonly status?: DecisionCycleStatus;
  readonly origin?: DecisionOrigin;
  /** Epoch ms lower bound on `createdAt` (inclusive). */
  readonly since?: number;
  /** Epoch ms upper bound on `createdAt` (inclusive). */
  readonly until?: number;
}

/**
 * Filter for the performance read model. Every field is optional and they
 * combine with AND. `since`/`until` bound the decision time, never the outcome
 * time. In the verification summary, `openCycles` only reacts to the filters
 * that describe a cycle (`cycleId`, `origin`); the other filters address
 * decisions and leave it untouched.
 */
export interface DecisionPerformanceFilter {
  readonly cycleId?: string;
  readonly side?: DecisionSide;
  readonly origin?: DecisionOrigin;
  readonly executionMode?: RepricerExecutionMode;
  /** Keep only decisions taken on an already-stale snapshot. */
  readonly staleOnly?: boolean;
  /** Keep only decisions with at least one outcome. */
  readonly verifiedOnly?: boolean;
  readonly since?: number;
  readonly until?: number;
}

export interface DecisionJournalRepository {
  /** Appends a normalized order book observation and returns it with its new id. */
  appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot>;
  /** Opens a cycle in `OPEN` status and returns it with its assigned id. */
  openCycle(input: OpenDecisionCycleInput): Promise<DecisionCycle>;
  /**
   * Moves an open cycle to a terminal status. Rejects when `input.status` is not
   * terminal (`CLOSED` | `ABANDONED`), when the cycle does not exist, or when it
   * already reached a terminal status — so the realized figures are written once.
   */
  closeCycle(cycleId: string, input: CloseDecisionCycleInput): Promise<DecisionCycle>;
  getCycle(cycleId: string): Promise<DecisionCycle | null>;
  listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]>;
  /**
   * Appends a decision. Rejects when `cycleId` is not an `OPEN` cycle or `snapshotId`
   * does not exist. The observed context is copied from the snapshot.
   */
  appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord>;
  getDecision(decisionId: number): Promise<RepricerDecisionRecord | null>;
  /** Decisions of a cycle, in insertion order. */
  listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]>;
  /** Appends an outcome. Rejects when `decisionId` does not exist. */
  appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome>;
  /** Outcomes of a decision, in insertion order. */
  listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]>;
  /**
   * `decision_performance` read model: decisions LEFT JOINed with their outcomes,
   * restricted to the actions that can carry one. See
   * `VERIFIABLE_DECISION_ACTIONS` and the implementation.
   */
  getDecisionPerformance(filter?: DecisionPerformanceFilter): Promise<DecisionPerformanceRow[]>;
  /**
   * Verification coverage and stale-data exposure for the same filter.
   *
   * Not a second slice of the same population: the verification counts cover only
   * the actions that can carry an outcome, the staleness counts cover every
   * decision the filter matches. See `VerificationSummary` and
   * `VERIFIABLE_DECISION_ACTIONS` for why one filter cannot serve both.
   */
  getVerificationSummary(filter?: DecisionPerformanceFilter): Promise<VerificationSummary>;
}

/** Optional pre-existing state, for tests and for hydrating an adapter. */
export interface DecisionJournalSeed {
  readonly snapshots?: readonly MarketSnapshot[];
  readonly cycles?: readonly DecisionCycle[];
  readonly decisions?: readonly RepricerDecisionRecord[];
  readonly outcomes?: readonly DecisionOutcome[];
}

/** Ratios are rounded to 4 decimals so repeated runs compare exactly. */
function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * The terminal statuses `closeCycle` accepts, as an allow-list.
 *
 * Mirrored verbatim in `electron/main/db/decision-journal.repository.ts`, which cannot
 * import from `projects/core` (`rootDir: "."` under `electron/tsconfig.json`); the parity
 * spec replays the same rejections through both adapters to keep the messages identical.
 */
const TERMINAL_CLOSE_STATUSES: readonly DecisionCycleCloseStatus[] = ['CLOSED', 'ABANDONED'];

/**
 * Refuses a `closeCycle` that asks for anything other than a terminal status.
 *
 * `CloseDecisionCycleInput['status']` is typed `'CLOSED' | 'ABANDONED'`, so at a
 * type-checked call site this is unreachable. It is still checked because the real caller
 * of the raw port is the IPC boundary, where the payload arrives as `unknown`: a
 * type-level guarantee is not a runtime one, and the cost of being wrong is a cycle that
 * reports itself open while carrying another cycle's realized figures.
 */
function assertTerminalCloseStatus(status: DecisionCycleCloseStatus): void {
  if (!TERMINAL_CLOSE_STATUSES.includes(status)) {
    throw new Error(
      `decision_journal: closeCycle requires a terminal status (${TERMINAL_CLOSE_STATUSES.join(' | ')}), got "${String(status)}"`,
    );
  }
}

function copyCycle(cycle: DecisionCycle): DecisionCycle {
  return { ...cycle };
}

function copyDecision(decision: RepricerDecisionRecord): RepricerDecisionRecord {
  return { ...decision, safetyFlags: [...decision.safetyFlags] };
}

function copyOutcome(outcome: DecisionOutcome): DecisionOutcome {
  return { ...outcome };
}

function copySnapshot(snapshot: MarketSnapshot): MarketSnapshot {
  return { ...snapshot };
}

function maxId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, row) => (row.id > max ? row.id : max), 0);
}

/**
 * Reference adapter: the executable specification of the port.
 *
 * The SQLite adapter must behave identically. When in doubt, this class is the
 * answer — including the read-model aggregation documented on
 * `DecisionPerformanceRow`.
 */
export class InMemoryDecisionJournalRepository implements DecisionJournalRepository {
  private readonly snapshots: MarketSnapshot[] = [];
  private readonly cycles = new Map<string, DecisionCycle>();
  private readonly decisions: RepricerDecisionRecord[] = [];
  private readonly outcomes: DecisionOutcome[] = [];
  private nextSnapshotId = 1;
  private nextDecisionId = 1;
  private nextOutcomeId = 1;
  private cycleSequence = 0;

  constructor(seed: DecisionJournalSeed = {}) {
    this.snapshots.push(...(seed.snapshots ?? []).map(copySnapshot));
    for (const cycle of seed.cycles ?? []) {
      this.cycles.set(cycle.id, copyCycle(cycle));
    }
    this.decisions.push(...(seed.decisions ?? []).map(copyDecision));
    this.outcomes.push(...(seed.outcomes ?? []).map(copyOutcome));
    this.nextSnapshotId = maxId(this.snapshots) + 1;
    this.nextDecisionId = maxId(this.decisions) + 1;
    this.nextOutcomeId = maxId(this.outcomes) + 1;
  }

  async appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot> {
    const now = Date.now();
    const snapshot: MarketSnapshot = {
      id: this.nextSnapshotId++,
      obi: input.obi,
      bidUsd: input.bidUsd,
      askUsd: input.askUsd,
      nBids: input.nBids,
      nAsks: input.nAsks,
      stale: input.stale,
      fetchedAt: input.fetchedAt ?? now,
      createdAt: now,
    };
    this.snapshots.push(snapshot);
    return copySnapshot(snapshot);
  }

  async openCycle(input: OpenDecisionCycleInput): Promise<DecisionCycle> {
    const now = Date.now();
    this.cycleSequence += 1;
    const cycle: DecisionCycle = {
      id: `cycle_${now}_${this.cycleSequence}`,
      status: 'OPEN',
      title: input.title,
      origin: input.origin,
      capitalReservedUsdt: input.capitalReservedUsdt,
      realizedProfitUsdt: null,
      realizedSpreadPct: null,
      closeReason: null,
      openedAt: input.openedAt ?? now,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.cycles.set(cycle.id, cycle);
    return copyCycle(cycle);
  }

  async closeCycle(
    cycleId: string,
    input: CloseDecisionCycleInput,
  ): Promise<DecisionCycle> {
    // Request first, state second. The status is validated by an allow-list and not by
    // `status !== 'OPEN'` on the stored row: the guard that matters is "this call asks
    // for a terminal status", which is a property of the request and has to hold even
    // for a cycle nobody has heard of. A negative check against the stored row answers a
    // different question — "is it open?" — and lets `status: 'OPEN'` through, stamping
    // `closedAt` and the realized figures on a cycle that still counts as open. A second
    // such call then passes the open-check and overwrites those figures, so the record
    // the operator reads to judge performance is whatever the last caller typed.
    assertTerminalCloseStatus(input.status);
    const cycle = this.cycles.get(cycleId);
    if (!cycle) {
      throw new Error(`decision_journal: unknown cycle "${cycleId}"`);
    }
    if (cycle.status !== 'OPEN') {
      throw new Error(
        `decision_journal: cycle "${cycleId}" is already ${cycle.status} and cannot be closed again`,
      );
    }
    const now = Date.now();
    const closed: DecisionCycle = {
      ...cycle,
      status: input.status,
      closeReason: input.closeReason,
      realizedProfitUsdt: input.realizedProfitUsdt,
      realizedSpreadPct: input.realizedSpreadPct,
      closedAt: input.closedAt ?? now,
      updatedAt: now,
    };
    this.cycles.set(cycleId, closed);
    return copyCycle(closed);
  }

  async getCycle(cycleId: string): Promise<DecisionCycle | null> {
    const cycle = this.cycles.get(cycleId);
    return cycle ? copyCycle(cycle) : null;
  }

  async listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]> {
    return Array.from(this.cycles.values())
      .filter((cycle) => {
        if (filter?.status && cycle.status !== filter.status) return false;
        if (filter?.origin && cycle.origin !== filter.origin) return false;
        if (filter?.since !== undefined && cycle.createdAt < filter.since) return false;
        if (filter?.until !== undefined && cycle.createdAt > filter.until) return false;
        return true;
      })
      .map(copyCycle);
  }

  async appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord> {
    const cycle = this.cycles.get(input.cycleId);
    if (!cycle) {
      throw new Error(`decision_journal: unknown cycle "${input.cycleId}"`);
    }
    // Only an OPEN cycle may receive decisions. Existence is not enough: a caller that
    // holds a cached `cycleId` keeps writing after the cycle was closed, and those
    // decisions land under a `realizedProfitUsdt` frozen at close time — figures that
    // were computed from none of them. The cycle total then stops describing the rows
    // underneath it while `openCycles` reports 0, which is an accounting lie, not a lag.
    if (cycle.status !== 'OPEN') {
      throw new Error(
        `decision_journal: cycle "${input.cycleId}" is ${cycle.status} and cannot accept new decisions`,
      );
    }
    const snapshot = this.snapshots.find((row) => row.id === input.snapshotId);
    if (!snapshot) {
      throw new Error(`decision_journal: unknown market snapshot ${input.snapshotId}`);
    }
    const decision: RepricerDecisionRecord = {
      id: this.nextDecisionId++,
      cycleId: input.cycleId,
      snapshotId: input.snapshotId,
      side: input.side,
      decisionPrice: input.decisionPrice,
      origin: input.origin,
      executionMode: input.executionMode,
      action: input.action,
      modeledSpreadPct: input.modeledSpreadPct,
      reason: input.reason,
      safetyFlags: [...(input.safetyFlags ?? [])],
      // Copied, never claimed: the decision cannot disagree with its evidence.
      observedObi: snapshot.obi,
      observedBidUsd: snapshot.bidUsd,
      observedAskUsd: snapshot.askUsd,
      observedStale: snapshot.stale,
      accountId: input.accountId,
      planId: input.planId,
      createdAt: Date.now(),
    };
    this.decisions.push(decision);
    return copyDecision(decision);
  }

  async getDecision(decisionId: number): Promise<RepricerDecisionRecord | null> {
    const decision = this.decisions.find((row) => row.id === decisionId);
    return decision ? copyDecision(decision) : null;
  }

  async listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]> {
    return this.decisions.filter((row) => row.cycleId === cycleId).map(copyDecision);
  }

  async appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome> {
    if (!this.decisions.some((row) => row.id === input.decisionId)) {
      throw new Error(`decision_journal: unknown decision ${input.decisionId}`);
    }
    const now = Date.now();
    const outcome: DecisionOutcome = {
      id: this.nextOutcomeId++,
      decisionId: input.decisionId,
      source: input.source,
      success: input.success,
      filledAmountUsdt: input.filledAmountUsdt,
      filledPrice: input.filledPrice ?? null,
      realizedSpreadPct: input.realizedSpreadPct ?? null,
      realizedProfitUsdt: input.realizedProfitUsdt ?? null,
      externalRef: input.externalRef ?? null,
      detail: input.detail ?? null,
      recordedAt: input.recordedAt ?? now,
      createdAt: now,
    };
    this.outcomes.push(outcome);
    return copyOutcome(outcome);
  }

  async listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]> {
    return this.outcomes.filter((row) => row.decisionId === decisionId).map(copyOutcome);
  }

  async getDecisionPerformance(
    filter?: DecisionPerformanceFilter,
  ): Promise<DecisionPerformanceRow[]> {
    // The performance read model covers the decisions that could have been EXECUTED, and
    // only those. A KEEP or a PAUSE has no publication attempt behind it, so all four of
    // its outcome columns are structurally empty: four guaranteed nulls per row, plus a
    // `modeledSpreadPct` (0 for a PAUSE fired by a missing book) that would drag the
    // modeled-vs-realized medians toward "we modeled nothing". They are not lost — they
    // stay in the journal and are readable through `listDecisionsByCycle`/`getDecision`;
    // what they are not is performance.
    //
    // This is also what keeps `rows.length === totalDecisions` in `buildDecisionSelfAudit`
    // true for a filter that contains KEEPs and PAUSEs.
    const verifiedIds = verifiedDecisionIds(this.outcomes);
    const rows: DecisionPerformanceRow[] = [];
    for (const decision of this.decisions) {
      if (!VERIFIABLE_DECISION_ACTIONS.includes(decision.action)) continue;
      if (!matchesPerformanceFilter(decision, filter, verifiedIds)) continue;
      rows.push(toPerformanceRow(decision, this.outcomes));
    }
    return rows;
  }

  async getVerificationSummary(
    filter?: DecisionPerformanceFilter,
  ): Promise<VerificationSummary> {
    const verifiedIds = verifiedDecisionIds(this.outcomes);
    // TWO slices, deliberately. The verification question ("of the decisions that
    // could have produced a publication attempt, how many did?") and the staleness
    // question ("how often did the engine decide on a book it knew was stale?") have
    // different populations, and forcing them to share one filter is how a summary
    // ends up quietly lying about one of them:
    //
    //  - One filter over the verifiable actions only: `verificationRate` becomes
    //    honest, and `staleDecisions` silently starts excluding every KEEP and PAUSE.
    //    Those are decided on stale books too — a PAUSE fired by a cached book is the
    //    case an operator most needs surfaced — so the staleness signal would shrink
    //    precisely where the engine is most likely to be wrong.
    //  - One filter over everything: the verification rate decays toward 0 for the
    //    rest of the session with no failure to explain it, and `decisionsAwaitingOutcome`
    //    counts rows nobody will ever fill.
    //
    // So verification is counted over the verifiable actions and staleness over
    // everything, and both denominators are reported (see `VERIFIABLE_DECISION_ACTIONS`).
    const journaled = this.decisions.filter((decision) =>
      matchesPerformanceFilter(decision, filter, verifiedIds),
    );
    const verifiable = journaled.filter((decision) =>
      VERIFIABLE_DECISION_ACTIONS.includes(decision.action),
    );
    const totalDecisions = verifiable.length;
    const verifiedDecisions = verifiable.filter((decision) => verifiedIds.has(decision.id))
      .length;
    const journaledDecisions = journaled.length;
    const staleDecisions = journaled.filter((decision) => decision.observedStale).length;

    return {
      totalDecisions,
      verifiedDecisions,
      verificationRate:
        totalDecisions === 0 ? 0 : roundRatio(verifiedDecisions / totalDecisions),
      journaledDecisions,
      staleDecisions,
      staleRate:
        journaledDecisions === 0 ? 0 : roundRatio(staleDecisions / journaledDecisions),
      openCycles: countOpenCycles(this.cycles, filter),
      decisionsAwaitingOutcome: totalDecisions - verifiedDecisions,
    };
  }
}

/** Decisions that have at least one outcome, i.e. the verifiable ones. */
function verifiedDecisionIds(outcomes: readonly DecisionOutcome[]): ReadonlySet<number> {
  return new Set(outcomes.map((outcome) => outcome.decisionId));
}

/**
 * `openCycles` counts the OPEN cycles of the filtered slice. Only the filters
 * that describe a cycle apply to it (`cycleId`, `origin`); the rest address
 * decisions and leave it untouched.
 */
function countOpenCycles(
  cycles: ReadonlyMap<string, DecisionCycle>,
  filter?: DecisionPerformanceFilter,
): number {
  const isOpen = (cycle: DecisionCycle) => cycle.status === 'OPEN';
  if (filter?.cycleId) {
    const cycle = cycles.get(filter.cycleId);
    return cycle && isOpen(cycle) ? 1 : 0;
  }
  if (filter?.origin) {
    return Array.from(cycles.values()).filter(
      (cycle) => isOpen(cycle) && cycle.origin === filter.origin,
    ).length;
  }
  return Array.from(cycles.values()).filter(isOpen).length;
}

function matchesPerformanceFilter(
  decision: RepricerDecisionRecord,
  filter: DecisionPerformanceFilter | undefined,
  verifiedIds: ReadonlySet<number>,
): boolean {
  if (!filter) return true;
  if (filter.cycleId && decision.cycleId !== filter.cycleId) return false;
  if (filter.side && decision.side !== filter.side) return false;
  if (filter.origin && decision.origin !== filter.origin) return false;
  if (filter.executionMode && decision.executionMode !== filter.executionMode) return false;
  if (filter.since !== undefined && decision.createdAt < filter.since) return false;
  if (filter.until !== undefined && decision.createdAt > filter.until) return false;
  if (filter.staleOnly && !decision.observedStale) return false;
  if (filter.verifiedOnly && !verifiedIds.has(decision.id)) return false;
  return true;
}

/** LEFT JOIN: the decision is always present, its outcomes are aggregated. */
function toPerformanceRow(
  decision: RepricerDecisionRecord,
  allOutcomes: readonly DecisionOutcome[],
): DecisionPerformanceRow {
  const outcomes = allOutcomes.filter((outcome) => outcome.decisionId === decision.id);
  return {
    decisionId: decision.id,
    cycleId: decision.cycleId,
    side: decision.side,
    origin: decision.origin,
    executionMode: decision.executionMode,
    decisionPrice: decision.decisionPrice,
    modeledSpreadPct: decision.modeledSpreadPct,
    observedStale: decision.observedStale,
    observedObi: decision.observedObi,
    fillCount: outcomes.length,
    realizedSpreadPct: weightedSpreadPct(outcomes),
    realizedProfitUsdt: sumReported(outcomes.map((outcome) => outcome.realizedProfitUsdt)),
    filledAmountUsdt:
      outcomes.length === 0
        ? null
        : outcomes.reduce((sum, outcome) => sum + outcome.filledAmountUsdt, 0),
    decidedAt: decision.createdAt,
  };
}

/** Sum of the reported values, or null when nothing reports one. */
function sumReported(values: readonly (number | null)[]): number | null {
  const reported = values.filter((value): value is number => value !== null);
  return reported.length === 0 ? null : reported.reduce((sum, value) => sum + value, 0);
}

/**
 * Notional-weighted mean of the reported spreads, or null when none reports one.
 *
 * The zero-notional fallback is the documented contract
 * (`DecisionPerformanceRow.realizedSpreadPct`) and must stay. When every reporting
 * outcome filled 0 the weighting is `SUM(spread * 0) / SUM(0)`, which is `0 / 0`: the
 * naive `weighted / reported.length` shortcut therefore reports **0%** for outcomes
 * that explicitly said 1% and 2%. That is the worst kind of wrong number — 0 is a
 * perfectly plausible realized spread, so a consumer cannot tell "we filled nothing"
 * apart from "we filled nothing AND the journal invented a 0% spread out of the data
 * it was given". Reporting the plain mean instead keeps the row honest: the data said
 * 1% and 2%, so the aggregate says 1.5%.
 *
 * Do not "simplify" this into a single expression without the branch. The case is
 * reachable in production via a historical/CSV import, where the spread is known and
 * the notional was never recorded.
 */
function weightedSpreadPct(outcomes: readonly DecisionOutcome[]): number | null {
  const reported = outcomes.filter(
    (outcome): outcome is DecisionOutcome & { realizedSpreadPct: number } =>
      outcome.realizedSpreadPct !== null,
  );
  if (reported.length === 0) return null;
  const notional = reported.reduce((sum, outcome) => sum + outcome.filledAmountUsdt, 0);
  if (notional > 0) {
    const weighted = reported.reduce(
      (sum, outcome) => sum + outcome.realizedSpreadPct * outcome.filledAmountUsdt,
      0,
    );
    return weighted / notional;
  }
  const plainSum = reported.reduce((sum, outcome) => sum + outcome.realizedSpreadPct, 0);
  return plainSum / reported.length;
}

/** The realized figures a cycle close must record. */
export interface RealizedCycleFigures {
  readonly realizedProfitUsdt: number;
  readonly realizedSpreadPct: number;
}

/**
 * Computes the realized figures of a whole cycle from the outcomes it recorded.
 *
 * This is the same aggregation the read model applies per decision, applied to the
 * union of the cycle's outcomes: reported profits are summed and the spread keeps
 * the notional weighting of {@link weightedSpreadPct}. Closing a cycle with figures
 * built by any other rule would make the cycle totals disagree with the decision
 * rows that produced them.
 *
 * Returns `null` — not zeros — when the recorded outcomes cannot justify a `CLOSED`
 * status: no outcomes at all, or no outcome reporting a realized spread, or none
 * reporting a realized profit. Zero is a plausible realized profit, so returning it
 * would be indistinguishable from a real break-even cycle. A caller that gets `null`
 * must not close the cycle as `CLOSED`; `ABANDONED` is the honest status for a cycle
 * whose executions were never verified.
 *
 * Note the current publisher records `filledAmountUsdt: 0` and reports no spread or
 * profit, so in production today this returns `null` for every cycle. That is the
 * intended behaviour: the journal must expose that it cannot prove a realized P&L
 * until a verified fill is recorded.
 */
export function realizedCycleFigures(
  outcomes: readonly DecisionOutcome[],
): RealizedCycleFigures | null {
  const realizedSpreadPct = weightedSpreadPct(outcomes);
  if (realizedSpreadPct === null) return null;
  const realizedProfitUsdt = sumReported(
    outcomes.map((outcome) => outcome.realizedProfitUsdt),
  );
  if (realizedProfitUsdt === null) return null;
  return { realizedProfitUsdt, realizedSpreadPct };
}
