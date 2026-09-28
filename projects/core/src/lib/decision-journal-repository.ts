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
 *  - **Only `decision_cycles` is mutable**, through `closeCycle`. A cycle that
 *    already reached `CLOSED` or `ABANDONED` can never be closed again. There
 *    is deliberately no `updateDecision` / `deleteOutcome` in this port.
 *  - **`observed*` fields are copied from the referenced snapshot**, never taken
 *    from the caller, so a decision cannot contradict its own market evidence.
 *  - **Reads never hand out internal references.** Every returned record is a
 *    copy, so callers cannot mutate the journal by accident.
 */

import type {
  CloseDecisionCycleInput,
  DecisionCycle,
  DecisionCycleStatus,
  DecisionOrigin,
  DecisionOutcome,
  DecisionPerformanceRow,
  DecisionSide,
  MarketSnapshot,
  OpenDecisionCycleInput,
  OutcomeSource,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
  RepricerDecisionRecord,
  RepricerExecutionMode,
  VerificationSummary,
} from './decision-journal';

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
   * Moves an open cycle to a terminal status. Rejects when the cycle does not
   * exist or is already `CLOSED`/`ABANDONED`.
   */
  closeCycle(cycleId: string, input: CloseDecisionCycleInput): Promise<DecisionCycle>;
  getCycle(cycleId: string): Promise<DecisionCycle | null>;
  listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]>;
  /**
   * Appends a decision. Rejects when `cycleId` or `snapshotId` do not exist.
   * The observed context is copied from the snapshot.
   */
  appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord>;
  getDecision(decisionId: number): Promise<RepricerDecisionRecord | null>;
  /** Decisions of a cycle, in insertion order. */
  listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]>;
  /** Appends an outcome. Rejects when `decisionId` does not exist. */
  appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome>;
  /** Outcomes of a decision, in insertion order. */
  listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]>;
  /** `decision_performance` read model: decisions LEFT JOINed with their outcomes. */
  getDecisionPerformance(filter?: DecisionPerformanceFilter): Promise<DecisionPerformanceRow[]>;
  /** Verification coverage and stale-data exposure for the same filter. */
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
    if (!this.cycles.has(input.cycleId)) {
      throw new Error(`decision_journal: unknown cycle "${input.cycleId}"`);
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
    const verifiedIds = verifiedDecisionIds(this.outcomes);
    const rows: DecisionPerformanceRow[] = [];
    for (const decision of this.decisions) {
      if (!matchesPerformanceFilter(decision, filter, verifiedIds)) continue;
      rows.push(toPerformanceRow(decision, this.outcomes));
    }
    return rows;
  }

  async getVerificationSummary(
    filter?: DecisionPerformanceFilter,
  ): Promise<VerificationSummary> {
    const verifiedIds = verifiedDecisionIds(this.outcomes);
    const decisions = this.decisions.filter((decision) =>
      matchesPerformanceFilter(decision, filter, verifiedIds),
    );
    const totalDecisions = decisions.length;
    const verifiedDecisions = decisions.filter((decision) => verifiedIds.has(decision.id)).length;
    const staleDecisions = decisions.filter((decision) => decision.observedStale).length;

    return {
      totalDecisions,
      verifiedDecisions,
      verificationRate:
        totalDecisions === 0 ? 0 : roundRatio(verifiedDecisions / totalDecisions),
      staleDecisions,
      staleRate: totalDecisions === 0 ? 0 : roundRatio(staleDecisions / totalDecisions),
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

/** Notional-weighted mean of the reported spreads, or null when none reports one. */
function weightedSpreadPct(outcomes: readonly DecisionOutcome[]): number | null {
  const reported = outcomes.filter(
    (outcome): outcome is DecisionOutcome & { realizedSpreadPct: number } =>
      outcome.realizedSpreadPct !== null,
  );
  if (reported.length === 0) return null;
  const notional = reported.reduce((sum, outcome) => sum + outcome.filledAmountUsdt, 0);
  const weighted = reported.reduce(
    (sum, outcome) => sum + outcome.realizedSpreadPct * outcome.filledAmountUsdt,
    0,
  );
  return notional > 0 ? weighted / notional : weighted / reported.length;
}
