/**
 * Decision Journal: pure domain types for the append-only memory of what the
 * engine decided, what it saw when it decided, and what happened afterwards.
 *
 * Framework-agnostic. No persistence, no network, no SQL. Concrete adapters
 * (SQLite in Electron) live outside this module and implement
 * `DecisionJournalRepository` (see `./decision-journal-repository`).
 *
 * Three rules shape every type here:
 *
 *  1. **Honesty over convenience.** `executionMode` records what really happened
 *     (`PUBLISHING` only when a publisher actually wrote an ad) and a failed
 *     publish is an outcome with `success: false`, never a missing row.
 *  2. **Append-only.** Only `DecisionCycle` changes after insertion. A decision
 *     and its outcomes are never updated: a journal that gets rewritten loses
 *     the property that makes it trustworthy.
 *  3. **Observed context is copied, never claimed.** `observed*` fields are
 *     denormalized from the `market_snapshots` row a decision points at, so a
 *     decision can never contradict the market it was taken on.
 */

import type { RepricerDecision } from './repricer';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Side of the operator book a decision applies to. */
export type DecisionSide = 'BUY' | 'SELL';

/**
 * Who took the decision. Explicit on every row because automated publishing is
 * in flight: separating human decisions from automatic ones is mandatory to
 * compute an honest win rate.
 */
export type DecisionOrigin = 'OPERATOR' | 'AUTO_ENGINE' | 'MCP_AGENT' | 'STRATEGY_PLAN';

/** Lifecycle of an accounting cycle. Only `OPEN` can receive new decisions. */
export type DecisionCycleStatus = 'OPEN' | 'CLOSED' | 'ABANDONED';

/** Terminal cycle statuses accepted by `closeCycle`. */
export type DecisionCycleCloseStatus = 'CLOSED' | 'ABANDONED';

/** Where a recorded outcome came from. */
export type OutcomeSource = 'LOCAL_SIGNAL' | 'BINANCE_MERCHANT' | 'CSV_IMPORT' | 'MANUAL';

/**
 * Real execution mode of the repricing engine.
 *
 * Mirrors `REPRICER_EXECUTION_MODES` in the Angular service (identical string
 * literals, so the two are structurally interchangeable). It is redeclared here
 * because core cannot import from the app layer, and because the journal must
 * be able to say `PUBLISHING` without depending on anything that runs a UI.
 */
export type RepricerExecutionMode = 'READ_ONLY' | 'PUBLISHING';

/**
 * Action a decision asked for. Reused from the repricer domain instead of being
 * redeclared, so the evaluation output and the journaled row can never drift.
 */
export type DecisionAction = RepricerDecision['action'];

/**
 * Literal sets, in the exact order the SQL `CHECK` constraints use them.
 *
 * Adapters must build their CHECK clauses from these arrays (or copy the order)
 * so the SQLite schema and the TypeScript unions can never disagree.
 */
export const DECISION_SIDES = ['BUY', 'SELL'] as const satisfies readonly DecisionSide[];
export const DECISION_ORIGINS = [
  'OPERATOR',
  'AUTO_ENGINE',
  'MCP_AGENT',
  'STRATEGY_PLAN',
] as const satisfies readonly DecisionOrigin[];
export const DECISION_CYCLE_STATUSES = [
  'OPEN',
  'CLOSED',
  'ABANDONED',
] as const satisfies readonly DecisionCycleStatus[];
export const DECISION_EXECUTION_MODES = [
  'READ_ONLY',
  'PUBLISHING',
] as const satisfies readonly RepricerExecutionMode[];
export const OUTCOME_SOURCES = [
  'LOCAL_SIGNAL',
  'BINANCE_MERCHANT',
  'CSV_IMPORT',
  'MANUAL',
] as const satisfies readonly OutcomeSource[];

// ---------------------------------------------------------------------------
// Append-only records
// ---------------------------------------------------------------------------

/**
 * Normalized observation of the order book at decision time.
 *
 * NOT the raw `adv/search` payload: storing ~40 KB of JSON per row is
 * unaffordable, so only the numbers the engine actually consumes are kept. `obi`
 * is the normalized ratio returned by `calculateOrderBookImbalance` (-1..1);
 * the journal stores that output, it never recomputes it.
 */
export interface MarketSnapshot {
  /** Monotonic row id, assigned by the repository. */
  readonly id: number;
  /** Order book imbalance, normalized to -1..1 (sell pressure..buy pressure). */
  readonly obi: number;
  /** Best bid price, in USDT per unit of fiat. */
  readonly bidUsd: number;
  /** Best ask price, in USDT per unit of fiat. */
  readonly askUsd: number;
  /** Number of bid levels considered. */
  readonly nBids: number;
  /** Number of ask levels considered. */
  readonly nAsks: number;
  /** True when the observation was already stale when it was stored. */
  readonly stale: boolean;
  /** Epoch ms when the book was observed. */
  readonly fetchedAt: number;
  /** Epoch ms when the row was written. */
  readonly createdAt: number;
}

/**
 * An accounting cycle: the unit a P2P operator actually reasons about, instead
 * of loose spreads. The only mutable record of the journal — it changes status
 * while it is open and is finalized once.
 */
export interface DecisionCycle {
  /** Stable cycle id, assigned by the repository. */
  readonly id: string;
  readonly status: DecisionCycleStatus;
  /** Human label, e.g. "Sesion 2026-02-03". */
  readonly title?: string;
  /** Who opened the cycle. */
  readonly origin: DecisionOrigin;
  /** Capital committed to this cycle, in USDT. */
  readonly capitalReservedUsdt: number;
  /** Realized profit in USDT; null until the cycle is closed. */
  readonly realizedProfitUsdt: number | null;
  /** Realized net spread percentage; null until the cycle is closed. */
  readonly realizedSpreadPct: number | null;
  /** Why the cycle was closed or abandoned; null while open. */
  readonly closeReason: string | null;
  /** Epoch ms when the cycle was opened. */
  readonly openedAt: number;
  /** Epoch ms when the cycle reached a terminal status; null while open. */
  readonly closedAt: number | null;
  readonly createdAt: number;
  /** Epoch ms of the last mutation (status change or close). */
  readonly updatedAt: number;
}

/**
 * A repricing decision plus the market it was taken on. Append-only: the port
 * exposes no update or delete for this record.
 */
export interface RepricerDecisionRecord {
  /** Monotonic row id, assigned by the repository. */
  readonly id: number;
  /** Owning cycle (hard reference). */
  readonly cycleId: string;
  /** Market observation the decision was taken on (hard reference, required). */
  readonly snapshotId: number;
  readonly side: DecisionSide;
  /** Price the engine decided to publish, in fiat per unit. */
  readonly decisionPrice: number;
  readonly origin: DecisionOrigin;
  /** What really happened: `PUBLISHING` only when an ad was actually written. */
  readonly executionMode: RepricerExecutionMode;
  /** What the engine asked for. */
  readonly action: DecisionAction;
  /** Spread the engine expected when it decided. */
  readonly modeledSpreadPct: number;
  /** Human-readable justification carried over from the evaluation. */
  readonly reason: string;
  /** Risk flags raised at decision time (empty when none). */
  readonly safetyFlags: readonly string[];
  /** Imbalance copied from the referenced snapshot. */
  readonly observedObi: number;
  /** Best bid copied from the referenced snapshot. */
  readonly observedBidUsd: number;
  /** Best ask copied from the referenced snapshot. */
  readonly observedAskUsd: number;
  /** Stale flag copied from the referenced snapshot. */
  readonly observedStale: boolean;
  /** Soft reference to `BankAccount.id`; no FK because that entity is not persisted yet. */
  readonly accountId?: string;
  /** Soft reference to `strategy_plans.id`; no FK for the same reason. */
  readonly planId?: string;
  readonly createdAt: number;
}

/**
 * A realized result attached to a decision. 1:N per decision: a partial fill is
 * another row, never an update. A failed publish is a row with
 * `success: false`, never silence.
 */
export interface DecisionOutcome {
  /** Monotonic row id, assigned by the repository. */
  readonly id: number;
  readonly decisionId: number;
  readonly source: OutcomeSource;
  /** False records a real failure (e.g. the merchant API rejected the ad). */
  readonly success: boolean;
  /** Notional actually filled, in USDT. 0 when nothing filled. */
  readonly filledAmountUsdt: number;
  /** Price the fill happened at; null when nothing filled. */
  readonly filledPrice: number | null;
  /** Realized net spread of this fill; null when unknown or not filled. */
  readonly realizedSpreadPct: number | null;
  /** Realized profit of this fill, in USDT; null when unknown or not filled. */
  readonly realizedProfitUsdt: number | null;
  /** External identifier: merchant order id, CSV row key, etc. */
  readonly externalRef: string | null;
  /** Free-form detail, typically the error text of a failed publish. */
  readonly detail: string | null;
  /** Epoch ms when the outcome happened. */
  readonly recordedAt: number;
  readonly createdAt: number;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/**
 * One row of the `decision_performance` read model: a decision LEFT JOINed with
 * its outcomes.
 *
 * A decision that produced no outcome is still present, with `fillCount: 0` and
 * null realized values. Rows are never dropped for being unverified: an
 * unverifiable decision is exactly what the operator must be able to see.
 *
 * Reference aggregation (adapters must match it):
 *  - `fillCount`      -> number of outcomes of the decision.
 *  - `filledAmountUsdt` -> sum of `filledAmountUsdt`; null when `fillCount` is 0.
 *  - `realizedProfitUsdt` -> sum of the reported `realizedProfitUsdt`; null when
 *    no outcome reports one.
 *  - `realizedSpreadPct` -> notional-weighted mean (`SUM(spread * filled) /
 *    SUM(filled)`) of the outcomes reporting one; null when none reports one.
 *    When all reporting outcomes filled 0, it falls back to the plain mean.
 */
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
  /** Number of outcomes found for this decision (0 when unverified). */
  readonly fillCount: number;
  readonly realizedSpreadPct: number | null;
  readonly realizedProfitUsdt: number | null;
  readonly filledAmountUsdt: number | null;
  /** Epoch ms of the decision, denormalized for time-window filters. */
  readonly decidedAt: number;
}

/**
 * How much of what the engine decided can actually be verified, and how much of
 * it was taken on stale data. Rates are 0..1 ratios, never percentages.
 */
export interface VerificationSummary {
  /** Decisions matching the filter. */
  readonly totalDecisions: number;
  /** Decisions with at least one outcome. */
  readonly verifiedDecisions: number;
  /** `verifiedDecisions / totalDecisions`; 0 when there are no decisions. */
  readonly verificationRate: number;
  /** Decisions whose referenced snapshot was already stale. */
  readonly staleDecisions: number;
  /** `staleDecisions / totalDecisions`; 0 when there are no decisions. */
  readonly staleRate: number;
  /** Cycles still OPEN, restricted to the `cycleId`/`origin` filter when present. */
  readonly openCycles: number;
  /** Decisions with zero outcomes, i.e. the verification backlog. */
  readonly decisionsAwaitingOutcome: number;
}

// ---------------------------------------------------------------------------
// Inputs
//
// Inputs never carry `id` or timestamps: the repository assigns them, so no
// caller can forge identity or backdate a row in an append-only journal.
// ---------------------------------------------------------------------------

export interface RecordMarketSnapshotInput {
  readonly obi: number;
  readonly bidUsd: number;
  readonly askUsd: number;
  readonly nBids: number;
  readonly nAsks: number;
  readonly stale: boolean;
  /** Epoch ms of the observation; defaults to now. */
  readonly fetchedAt?: number;
}

export interface OpenDecisionCycleInput {
  readonly origin: DecisionOrigin;
  readonly capitalReservedUsdt: number;
  readonly title?: string;
  /**
   * Epoch ms of the opening; defaults to now. Kept separate from `createdAt`
   * (when the row was written) so a cycle imported from a past session keeps
   * its real opening time.
   */
  readonly openedAt?: number;
}

export interface CloseDecisionCycleInput {
  /** Terminal status to move to. `OPEN` is not a valid argument. */
  readonly status: DecisionCycleCloseStatus;
  readonly closeReason: string;
  /**
   * Realized profit in USDT, computed by the caller from the cycle's outcomes.
   * Required on purpose: the port persists figures, it never aggregates them
   * behind the caller's back, so every adapter can be audited against the same
   * explicit input.
   */
  readonly realizedProfitUsdt: number;
  /** Realized net spread percentage, computed by the caller from the outcomes. */
  readonly realizedSpreadPct: number;
  /** Epoch ms of the close; defaults to now. */
  readonly closedAt?: number;
}

export interface RecordDecisionInput {
  /** Owning cycle; must already exist. */
  readonly cycleId: string;
  /**
   * Market observation this decision was taken on; must already exist. A
   * decision without a snapshot cannot be audited, so it is not optional.
   */
  readonly snapshotId: number;
  readonly side: DecisionSide;
  readonly decisionPrice: number;
  readonly origin: DecisionOrigin;
  readonly executionMode: RepricerExecutionMode;
  readonly action: DecisionAction;
  readonly modeledSpreadPct: number;
  readonly reason: string;
  /** Risk flags raised at decision time; defaults to empty. */
  readonly safetyFlags?: readonly string[];
  /** Soft reference to `BankAccount.id`. */
  readonly accountId?: string;
  /** Soft reference to `strategy_plans.id`. */
  readonly planId?: string;
}

export interface RecordOutcomeInput {
  /** Decision this outcome belongs to; must already exist. */
  readonly decisionId: number;
  readonly source: OutcomeSource;
  readonly success: boolean;
  readonly filledAmountUsdt: number;
  readonly filledPrice?: number;
  readonly realizedSpreadPct?: number;
  readonly realizedProfitUsdt?: number;
  readonly externalRef?: string;
  readonly detail?: string;
  /** Epoch ms of the event; defaults to now. */
  readonly recordedAt?: number;
}
