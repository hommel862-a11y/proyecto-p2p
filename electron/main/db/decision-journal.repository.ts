/**
 * SQLite adapter for the Decision Journal port.
 *
 * ## Why the domain types are mirrored here instead of imported
 *
 * The port and its types live in `projects/core/src/lib/`, but
 * `electron/tsconfig.json` pins `rootDir: "."` to the `electron/` folder, so any
 * production import from `projects/core` fails the build with `TS6059`. The vendored
 * copy of core cannot be extended inside this task's ownership either.
 *
 * So the contract is mirrored locally below, and two things keep the mirror honest:
 *
 *  1. `main/db/decision-journal.repository.spec.ts` imports the real core port and
 *     assigns `SqliteDecisionJournalRepository` to it with no cast, so the mirror
 *     must be structurally identical or the spec stops type-checking.
 *  2. The same spec replays one write sequence against this adapter and against
 *     `InMemoryDecisionJournalRepository` and requires byte-identical results.
 *
 * The in-memory adapter in core is the executable specification of the port. When the
 * two disagree, that class is the answer.
 */

import type { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Mirrored contract (see the file header: kept in sync by the spec)
// ---------------------------------------------------------------------------

export type DecisionSide = 'BUY' | 'SELL';
export type DecisionOrigin = 'OPERATOR' | 'AUTO_ENGINE' | 'MCP_AGENT' | 'STRATEGY_PLAN';
export type DecisionCycleStatus = 'OPEN' | 'CLOSED' | 'ABANDONED';
export type DecisionCycleCloseStatus = 'CLOSED' | 'ABANDONED';
export type OutcomeSource = 'LOCAL_SIGNAL' | 'BINANCE_MERCHANT' | 'CSV_IMPORT' | 'MANUAL';
export type RepricerExecutionMode = 'READ_ONLY' | 'PUBLISHING';
export type DecisionAction = 'UPDATE' | 'KEEP' | 'PAUSE';

export interface MarketSnapshot {
  readonly id: number;
  readonly obi: number;
  readonly bidUsd: number;
  readonly askUsd: number;
  readonly nBids: number;
  readonly nAsks: number;
  readonly stale: boolean;
  readonly fetchedAt: number;
  readonly createdAt: number;
}

export interface DecisionCycle {
  readonly id: string;
  readonly status: DecisionCycleStatus;
  readonly title?: string;
  readonly origin: DecisionOrigin;
  readonly capitalReservedUsdt: number;
  readonly realizedProfitUsdt: number | null;
  readonly realizedSpreadPct: number | null;
  readonly closeReason: string | null;
  readonly openedAt: number;
  readonly closedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RepricerDecisionRecord {
  readonly id: number;
  readonly cycleId: string;
  readonly snapshotId: number;
  readonly side: DecisionSide;
  readonly decisionPrice: number;
  readonly origin: DecisionOrigin;
  readonly executionMode: RepricerExecutionMode;
  readonly action: DecisionAction;
  readonly modeledSpreadPct: number;
  readonly reason: string;
  readonly safetyFlags: readonly string[];
  readonly observedObi: number;
  readonly observedBidUsd: number;
  readonly observedAskUsd: number;
  readonly observedStale: boolean;
  readonly accountId?: string;
  readonly planId?: string;
  readonly createdAt: number;
}

export interface DecisionOutcome {
  readonly id: number;
  readonly decisionId: number;
  readonly source: OutcomeSource;
  readonly success: boolean;
  readonly filledAmountUsdt: number;
  readonly filledPrice: number | null;
  readonly realizedSpreadPct: number | null;
  readonly realizedProfitUsdt: number | null;
  readonly externalRef: string | null;
  readonly detail: string | null;
  readonly recordedAt: number;
  readonly createdAt: number;
}

export interface DecisionPerformanceRow {
  readonly decisionId: number;
  readonly cycleId: string;
  readonly side: DecisionSide;
  readonly origin: DecisionOrigin;
  readonly executionMode: RepricerExecutionMode;
  readonly decisionPrice: number;
  readonly modeledSpreadPct: number;
  readonly observedStale: boolean;
  readonly observedObi: number;
  readonly fillCount: number;
  readonly realizedSpreadPct: number | null;
  readonly realizedProfitUsdt: number | null;
  readonly filledAmountUsdt: number | null;
  readonly decidedAt: number;
}

export interface VerificationSummary {
  readonly totalDecisions: number;
  readonly verifiedDecisions: number;
  readonly verificationRate: number;
  readonly staleDecisions: number;
  readonly staleRate: number;
  readonly openCycles: number;
  readonly decisionsAwaitingOutcome: number;
}

export interface RecordMarketSnapshotInput {
  readonly obi: number;
  readonly bidUsd: number;
  readonly askUsd: number;
  readonly nBids: number;
  readonly nAsks: number;
  readonly stale: boolean;
  readonly fetchedAt?: number;
}

export interface OpenDecisionCycleInput {
  readonly origin: DecisionOrigin;
  readonly capitalReservedUsdt: number;
  readonly title?: string;
  readonly openedAt?: number;
}

export interface CloseDecisionCycleInput {
  readonly status: DecisionCycleCloseStatus;
  readonly closeReason: string;
  readonly realizedProfitUsdt: number;
  readonly realizedSpreadPct: number;
  readonly closedAt?: number;
}

export interface RecordDecisionInput {
  readonly cycleId: string;
  readonly snapshotId: number;
  readonly side: DecisionSide;
  readonly decisionPrice: number;
  readonly origin: DecisionOrigin;
  readonly executionMode: RepricerExecutionMode;
  readonly action: DecisionAction;
  readonly modeledSpreadPct: number;
  readonly reason: string;
  readonly safetyFlags?: readonly string[];
  readonly accountId?: string;
  readonly planId?: string;
}

export interface RecordOutcomeInput {
  readonly decisionId: number;
  readonly source: OutcomeSource;
  readonly success: boolean;
  readonly filledAmountUsdt: number;
  readonly filledPrice?: number;
  readonly realizedSpreadPct?: number;
  readonly realizedProfitUsdt?: number;
  readonly externalRef?: string;
  readonly detail?: string;
  readonly recordedAt?: number;
}

export interface DecisionCyclesFilter {
  readonly status?: DecisionCycleStatus;
  readonly origin?: DecisionOrigin;
  readonly since?: number;
  readonly until?: number;
}

export interface DecisionPerformanceFilter {
  readonly cycleId?: string;
  readonly side?: DecisionSide;
  readonly origin?: DecisionOrigin;
  readonly executionMode?: RepricerExecutionMode;
  readonly staleOnly?: boolean;
  readonly verifiedOnly?: boolean;
  readonly since?: number;
  readonly until?: number;
}

export interface DecisionJournalRepository {
  appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot>;
  openCycle(input: OpenDecisionCycleInput): Promise<DecisionCycle>;
  closeCycle(cycleId: string, input: CloseDecisionCycleInput): Promise<DecisionCycle>;
  getCycle(cycleId: string): Promise<DecisionCycle | null>;
  listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]>;
  appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord>;
  getDecision(decisionId: number): Promise<RepricerDecisionRecord | null>;
  listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]>;
  appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome>;
  listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]>;
  getDecisionPerformance(filter?: DecisionPerformanceFilter): Promise<DecisionPerformanceRow[]>;
  getVerificationSummary(filter?: DecisionPerformanceFilter): Promise<VerificationSummary>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const num = (row: Row, key: string): number => Number(row[key]);
const bool = (row: Row, key: string): boolean => Number(row[key]) === 1;
const str = (row: Row, key: string): string => String(row[key]);
/** `title` is optional in the domain, so a NULL column means "absent", not `null`. */
const optStr = (row: Row, key: string): string | undefined => {
  const value = row[key];
  return value === null || value === undefined ? undefined : String(value);
};
const numOrNull = (row: Row, key: string): number | null => {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
};
const strOrNull = (row: Row, key: string): string | null => {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
};

/** Errors are flat and prefixed, never a driver-specific wrapper. */
const fail = (message: string): Error => new Error(`decision_journal: ${message}`);

/** Ratios are rounded to 4 decimals so repeated runs compare exactly. */
const roundRatio = (value: number): number => Number(value.toFixed(4));

function mapSnapshot(row: Row): MarketSnapshot {
  return {
    id: num(row, 'id'),
    obi: num(row, 'obi'),
    bidUsd: num(row, 'bid_usd'),
    askUsd: num(row, 'ask_usd'),
    nBids: num(row, 'n_bids'),
    nAsks: num(row, 'n_asks'),
    stale: bool(row, 'stale'),
    fetchedAt: num(row, 'fetched_at'),
    createdAt: num(row, 'created_at'),
  };
}

function mapCycle(row: Row): DecisionCycle {
  return {
    id: str(row, 'id'),
    status: str(row, 'status') as DecisionCycleStatus,
    title: optStr(row, 'title'),
    origin: str(row, 'origin') as DecisionOrigin,
    capitalReservedUsdt: num(row, 'capital_reserved_usdt'),
    realizedProfitUsdt: numOrNull(row, 'realized_profit_usdt'),
    realizedSpreadPct: numOrNull(row, 'realized_spread_pct'),
    closeReason: strOrNull(row, 'close_reason'),
    openedAt: num(row, 'opened_at'),
    closedAt: numOrNull(row, 'closed_at'),
    createdAt: num(row, 'created_at'),
    updatedAt: num(row, 'updated_at'),
  };
}

function mapDecision(row: Row): RepricerDecisionRecord {
  const flagsJson = strOrNull(row, 'safety_flags_json');
  return {
    id: num(row, 'id'),
    cycleId: str(row, 'cycle_id'),
    snapshotId: num(row, 'snapshot_id'),
    side: str(row, 'side') as DecisionSide,
    decisionPrice: num(row, 'decision_price'),
    origin: str(row, 'origin') as DecisionOrigin,
    executionMode: str(row, 'execution_mode') as RepricerExecutionMode,
    action: str(row, 'action') as DecisionAction,
    modeledSpreadPct: num(row, 'modeled_spread_pct'),
    reason: str(row, 'reason'),
    safetyFlags: flagsJson ? (JSON.parse(flagsJson) as string[]) : [],
    observedObi: num(row, 'observed_obi'),
    observedBidUsd: num(row, 'observed_bid_usd'),
    observedAskUsd: num(row, 'observed_ask_usd'),
    observedStale: bool(row, 'observed_stale'),
    accountId: optStr(row, 'account_id'),
    planId: optStr(row, 'plan_id'),
    createdAt: num(row, 'created_at'),
  };
}

function mapOutcome(row: Row): DecisionOutcome {
  return {
    id: num(row, 'id'),
    decisionId: num(row, 'decision_id'),
    source: str(row, 'source') as OutcomeSource,
    success: bool(row, 'success'),
    filledAmountUsdt: num(row, 'filled_amount_usdt'),
    filledPrice: numOrNull(row, 'filled_price'),
    realizedSpreadPct: numOrNull(row, 'realized_spread_pct'),
    realizedProfitUsdt: numOrNull(row, 'realized_profit_usdt'),
    externalRef: strOrNull(row, 'external_ref'),
    detail: strOrNull(row, 'detail'),
    recordedAt: num(row, 'recorded_at'),
    createdAt: num(row, 'created_at'),
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * `DatabaseSync` is synchronous, so every method here is an `async` function that
 * resolves immediately. The port stays promise-based because the core in-memory
 * adapter does, and an Angular renderer must never block on a query.
 */
/**
 * Operations accepted by the single `p2p:db-decision-journal` channel.
 *
 * One channel plus an explicit op, rather than one channel per operation: the journal
 * is a single append-only record set, so a single allow-listed entry point keeps the
 * renderer surface auditable in one place. This union is the shared vocabulary — the
 * IPC handler switches exhaustively over it, so adding an op here without wiring a
 * handler is a compile error rather than a runtime surprise.
 *
 * It lives here, in the main-process program, on purpose. `electron/tsconfig.json`
 * includes only `main/**` and `shared/**`, so `preload/` is not typechecked; the
 * renderer bridge therefore imports this as a *type only* (erased at compile time, so
 * it cannot drag `node:sqlite` into the preload) instead of the main process importing
 * from the preload, which would pull the untyped preload into the main program.
 */
export type DecisionJournalOp =
  | 'appendMarketSnapshot'
  | 'openCycle'
  | 'closeCycle'
  | 'getCycle'
  | 'listCycles'
  | 'appendDecision'
  | 'getDecision'
  | 'listDecisionsByCycle'
  | 'appendOutcome'
  | 'listOutcomesByDecision'
  | 'getDecisionPerformance'
  | 'getVerificationSummary'
  | 'purgeMarketSnapshotsBefore';

/**
 * The `p2p:db-decision-journal` wire shape. `op` is narrowed by the union above;
 * `payload` stays opaque at the IPC boundary and is cast per op inside the handler,
 * because the domain types live in `@p2p/core`, which the Electron tsconfig
 * (`rootDir: "."`) forbids importing from here.
 */
export interface DecisionJournalRequest {
  op: DecisionJournalOp;
  payload?: unknown;
}

export class SqliteDecisionJournalRepository implements DecisionJournalRepository {
  private readonly db: DatabaseSync;
  /**
   * Cycle ids embed a per-connection sequence (`cycle_<now>_<n>`), matching the
   * in-memory adapter. Initialized lazily on the first `openCycle` and seeded from
   * `COUNT(*)` so ids stay unique when the database is reopened, which also keeps the
   * constructor free of schema access.
   */
  private cycleSequence: number | null = null;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private nextCycleSequence(): number {
    if (this.cycleSequence === null) {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM decision_cycles').get() as Row;
      this.cycleSequence = num(row, 'n');
    }
    this.cycleSequence += 1;
    return this.cycleSequence;
  }

  async appendMarketSnapshot(input: RecordMarketSnapshotInput): Promise<MarketSnapshot> {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO market_snapshots
           (obi, bid_usd, ask_usd, n_bids, n_asks, stale, fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.obi,
        input.bidUsd,
        input.askUsd,
        input.nBids,
        input.nAsks,
        input.stale ? 1 : 0,
        input.fetchedAt ?? now,
        now,
      );
    return mapSnapshot(
      this.db
        .prepare('SELECT * FROM market_snapshots WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as Row,
    );
  }

  async openCycle(input: OpenDecisionCycleInput): Promise<DecisionCycle> {
    const now = Date.now();
    const id = `cycle_${now}_${this.nextCycleSequence()}`;
    this.db
      .prepare(
        `INSERT INTO decision_cycles
           (id, status, title, origin, capital_reserved_usdt,
            realized_profit_usdt, realized_spread_pct, close_reason,
            opened_at, closed_at, created_at, updated_at)
         VALUES (?, 'OPEN', ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
      )
      .run(id, input.title ?? null, input.origin, input.capitalReservedUsdt, input.openedAt ?? now, now, now);
    return mapCycle(this.db.prepare('SELECT * FROM decision_cycles WHERE id = ?').get(id) as Row);
  }

  async closeCycle(cycleId: string, input: CloseDecisionCycleInput): Promise<DecisionCycle> {
    const existing = this.db
      .prepare('SELECT * FROM decision_cycles WHERE id = ?')
      .get(cycleId) as Row | undefined;
    if (!existing) {
      throw fail(`unknown cycle "${cycleId}"`);
    }
    if (str(existing, 'status') !== 'OPEN') {
      throw fail(
        `cycle "${cycleId}" is already ${str(existing, 'status')} and cannot be closed again`,
      );
    }
    // The realized figures are the caller's, never an aggregate recomputed here.
    this.db
      .prepare(
        `UPDATE decision_cycles
            SET status = ?, close_reason = ?, realized_profit_usdt = ?,
                realized_spread_pct = ?, closed_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.status,
        input.closeReason,
        input.realizedProfitUsdt,
        input.realizedSpreadPct,
        input.closedAt ?? Date.now(),
        Date.now(),
        cycleId,
      );
    return mapCycle(this.db.prepare('SELECT * FROM decision_cycles WHERE id = ?').get(cycleId) as Row);
  }

  async getCycle(cycleId: string): Promise<DecisionCycle | null> {
    const row = this.db.prepare('SELECT * FROM decision_cycles WHERE id = ?').get(cycleId) as
      | Row
      | undefined;
    return row ? mapCycle(row) : null;
  }

  async listCycles(filter?: DecisionCyclesFilter): Promise<DecisionCycle[]> {
    const { where, params } = buildCyclesFilter(filter);
    const rows = this.db
      .prepare(`SELECT * FROM decision_cycles${where} ORDER BY id ASC`)
      .all(...params) as Row[];
    return rows.map(mapCycle);
  }

  async appendDecision(input: RecordDecisionInput): Promise<RepricerDecisionRecord> {
    // Existence is checked here so the rejection is a flat, prefixed Error rather
    // than a raw SQLite driver message. The hard FKs in schema.sql are the backstop.
    // Order matters: the cycle is validated first, matching the reference adapter.
    const cycle = this.db
      .prepare('SELECT id FROM decision_cycles WHERE id = ?')
      .get(input.cycleId) as Row | undefined;
    if (!cycle) {
      throw fail(`unknown cycle "${input.cycleId}"`);
    }
    const snapshot = this.db
      .prepare('SELECT * FROM market_snapshots WHERE id = ?')
      .get(input.snapshotId) as Row | undefined;
    if (!snapshot) {
      throw fail(`unknown market snapshot ${input.snapshotId}`);
    }

    const info = this.db
      .prepare(
        `INSERT INTO repricer_decisions (
           cycle_id, snapshot_id, side, decision_price, origin, execution_mode, action,
           modeled_spread_pct, reason, safety_flags_json,
           observed_obi, observed_bid_usd, observed_ask_usd, observed_stale,
           account_id, plan_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.cycleId,
        input.snapshotId,
        input.side,
        input.decisionPrice,
        input.origin,
        input.executionMode,
        input.action,
        input.modeledSpreadPct,
        input.reason,
        JSON.stringify([...(input.safetyFlags ?? [])]),
        // Copied, never claimed: the decision cannot disagree with its evidence.
        num(snapshot, 'obi'),
        num(snapshot, 'bid_usd'),
        num(snapshot, 'ask_usd'),
        num(snapshot, 'stale'),
        input.accountId ?? null,
        input.planId ?? null,
        Date.now(),
      );
    return mapDecision(
      this.db
        .prepare('SELECT * FROM repricer_decisions WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as Row,
    );
  }

  async getDecision(decisionId: number): Promise<RepricerDecisionRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM repricer_decisions WHERE id = ?')
      .get(decisionId) as Row | undefined;
    return row ? mapDecision(row) : null;
  }

  async listDecisionsByCycle(cycleId: string): Promise<RepricerDecisionRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM repricer_decisions WHERE cycle_id = ? ORDER BY id ASC')
      .all(cycleId) as Row[];
    return rows.map(mapDecision);
  }

  async appendOutcome(input: RecordOutcomeInput): Promise<DecisionOutcome> {
    const decision = this.db
      .prepare('SELECT id FROM repricer_decisions WHERE id = ?')
      .get(input.decisionId) as Row | undefined;
    if (!decision) {
      throw fail(`unknown decision ${input.decisionId}`);
    }
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO decision_outcomes (
           decision_id, source, success, filled_amount_usdt, filled_price,
           realized_spread_pct, realized_profit_usdt, external_ref, detail,
           recorded_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.decisionId,
        input.source,
        input.success ? 1 : 0,
        input.filledAmountUsdt,
        input.filledPrice ?? null,
        input.realizedSpreadPct ?? null,
        input.realizedProfitUsdt ?? null,
        input.externalRef ?? null,
        input.detail ?? null,
        input.recordedAt ?? now,
        now,
      );
    return mapOutcome(
      this.db
        .prepare('SELECT * FROM decision_outcomes WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as Row,
    );
  }

  async listOutcomesByDecision(decisionId: number): Promise<DecisionOutcome[]> {
    const rows = this.db
      .prepare('SELECT * FROM decision_outcomes WHERE decision_id = ? ORDER BY id ASC')
      .all(decisionId) as Row[];
    return rows.map(mapOutcome);
  }

  async getDecisionPerformance(
    filter?: DecisionPerformanceFilter,
  ): Promise<DecisionPerformanceRow[]> {
    const { where, params } = buildPerformanceFilter(filter);
    const rows = this.db
      .prepare(`SELECT * FROM decision_performance${where} ORDER BY decision_id ASC`)
      .all(...params) as Row[];
    return rows.map(mapPerformanceRow);
  }

  async getVerificationSummary(filter?: DecisionPerformanceFilter): Promise<VerificationSummary> {
    // Same filters as the read model, aggregated: the summary is a fold over exactly
    // the decisions `getDecisionPerformance` would return, never a second definition.
    const { where, params } = buildPerformanceFilter(filter);
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_decisions,
           SUM(CASE WHEN fill_count > 0 THEN 1 ELSE 0 END) AS verified_decisions,
           SUM(CASE WHEN observed_stale THEN 1 ELSE 0 END) AS stale_decisions
         FROM decision_performance${where}`,
      )
      .get(...params) as Row;

    const totalDecisions = num(row, 'total_decisions');
    const verifiedDecisions = num(row, 'verified_decisions');
    const staleDecisions = num(row, 'stale_decisions');

    return {
      totalDecisions,
      verifiedDecisions,
      verificationRate:
        totalDecisions === 0 ? 0 : roundRatio(verifiedDecisions / totalDecisions),
      staleDecisions,
      staleRate: totalDecisions === 0 ? 0 : roundRatio(staleDecisions / totalDecisions),
      openCycles: countOpenCycles(this.db, filter),
      decisionsAwaitingOutcome: totalDecisions - verifiedDecisions,
    };
  }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Retention for the only prunable journal table.
 *
 * `market_snapshots` grows with every observation, while cycles, decisions and
 * outcomes are the trustworthy record and are never deleted. A snapshot a decision
 * still cites cannot go away: `repricer_decisions.snapshot_id` is a hard FK, so the
 * `NOT EXISTS` guard makes the purge a no-op for referenced rows instead of failing
 * the whole statement. That means retention is best effort for cited snapshots, which
 * is the deliberate trade-off: losing the evidence a decision rests on would be worse
 * than keeping a row.
 *
 * @param cutoff exclusive: rows with `fetched_at < cutoff` are candidates.
 * @returns the number of rows actually deleted.
 */
export function purgeMarketSnapshotsBefore(db: DatabaseSync, cutoff: number): number {
  const info = db
    .prepare(
      `DELETE FROM market_snapshots
        WHERE fetched_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM repricer_decisions d WHERE d.snapshot_id = market_snapshots.id
          )`,
    )
    .run(cutoff);
  return Number(info.changes);
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

interface BuiltFilter {
  readonly where: string;
  readonly params: (string | number)[];
}

function buildCyclesFilter(filter?: DecisionCyclesFilter): BuiltFilter {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.origin) {
    conditions.push('origin = ?');
    params.push(filter.origin);
  }
  if (filter?.since !== undefined) {
    conditions.push('created_at >= ?');
    params.push(filter.since);
  }
  if (filter?.until !== undefined) {
    conditions.push('created_at <= ?');
    params.push(filter.until);
  }
  return { where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * Filters over the `decision_performance` view. `verifiedOnly` maps to `fill_count > 0`
 * because a decision is verifiable exactly when it has at least one outcome — an
 * unverifiable decision is never dropped, only filtered out when explicitly asked for.
 */
function buildPerformanceFilter(filter?: DecisionPerformanceFilter): BuiltFilter {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter?.cycleId) {
    conditions.push('cycle_id = ?');
    params.push(filter.cycleId);
  }
  if (filter?.side) {
    conditions.push('side = ?');
    params.push(filter.side);
  }
  if (filter?.origin) {
    conditions.push('origin = ?');
    params.push(filter.origin);
  }
  if (filter?.executionMode) {
    conditions.push('execution_mode = ?');
    params.push(filter.executionMode);
  }
  if (filter?.since !== undefined) {
    conditions.push('decided_at >= ?');
    params.push(filter.since);
  }
  if (filter?.until !== undefined) {
    conditions.push('decided_at <= ?');
    params.push(filter.until);
  }
  if (filter?.staleOnly) {
    conditions.push('observed_stale = 1');
  }
  if (filter?.verifiedOnly) {
    conditions.push('fill_count > 0');
  }
  return { where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '', params };
}

/**
 * `openCycles` counts OPEN cycles and is restricted only by the filters that describe a
 * cycle (`cycleId`, `origin`); `side`, `executionMode`, the time window and the
 * decision-only flags address decisions and leave it untouched.
 */
function countOpenCycles(db: DatabaseSync, filter?: DecisionPerformanceFilter): number {
  if (filter?.cycleId) {
    const row = db
      .prepare("SELECT id FROM decision_cycles WHERE id = ? AND status = 'OPEN'")
      .get(filter.cycleId) as Row | undefined;
    return row ? 1 : 0;
  }
  if (filter?.origin) {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM decision_cycles WHERE status = 'OPEN' AND origin = ?")
      .get(filter.origin) as Row;
    return num(row, 'n');
  }
  const row = db.prepare("SELECT COUNT(*) AS n FROM decision_cycles WHERE status = 'OPEN'").get() as Row;
  return num(row, 'n');
}

/**
 * The view hands out raw aggregates; the fallback rule lives here, in one place, so it
 * is auditable. Notional-weighted mean of the reported spreads; when every reporting
 * outcome filled 0 the weighting is meaningless, so it falls back to the plain mean,
 * as `DecisionPerformanceRow.realizedSpreadPct` documents in core.
 */
function mapPerformanceRow(row: Row): DecisionPerformanceRow {
  const fillCount = num(row, 'fill_count');
  const reportingCount = num(row, 'spread_reporting_count');
  const weightedDenominator = num(row, 'spread_weighted_denominator');
  const weightedNumerator = num(row, 'spread_weighted_numerator');

  let realizedSpreadPct: number | null = null;
  if (reportingCount > 0) {
    realizedSpreadPct =
      weightedDenominator > 0
        ? weightedNumerator / weightedDenominator
        : num(row, 'spread_plain_sum') / reportingCount;
  }

  return {
    decisionId: num(row, 'decision_id'),
    cycleId: str(row, 'cycle_id'),
    side: str(row, 'side') as DecisionSide,
    origin: str(row, 'origin') as DecisionOrigin,
    executionMode: str(row, 'execution_mode') as RepricerExecutionMode,
    decisionPrice: num(row, 'decision_price'),
    modeledSpreadPct: num(row, 'modeled_spread_pct'),
    observedStale: bool(row, 'observed_stale'),
    observedObi: num(row, 'observed_obi'),
    fillCount,
    realizedSpreadPct,
    realizedProfitUsdt: numOrNull(row, 'realized_profit_usdt'),
    // Null means "no outcome at all", which is different from "outcomes that filled 0".
    filledAmountUsdt: fillCount === 0 ? null : num(row, 'filled_amount_usdt'),
    decidedAt: num(row, 'decided_at'),
  };
}
