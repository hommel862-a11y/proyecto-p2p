/**
 * Parity contract for the SQLite Decision Journal adapter.
 *
 * The bar is NOT "the SQL does not throw". It is: **for every read, the SQLite adapter
 * returns exactly what `InMemoryDecisionJournalRepository` returns** for the same
 * sequence of port calls. `InMemoryDecisionJournalRepository` is the executable
 * specification of the port (see `projects/core/src/lib/decision-journal-repository.ts`),
 * so a divergence caught here is a divergence in the contract, not in the storage.
 *
 * This spec is also the only place that can compare `schema.sql` against the core enum
 * arrays: `electron/tsconfig.json` pins `rootDir: "."` (tsc TS6059) and cannot import
 * from `projects/core`, so the SQL CHECK lists are literal copies and this file is the
 * guard proving they have not drifted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SqliteDecisionJournalRepository,
  purgeMarketSnapshotsBefore,
} from './decision-journal.repository';
import { P2PDatabaseService } from './database';
import {
  DECISION_CYCLE_STATUSES,
  DECISION_EXECUTION_MODES,
  DECISION_ORIGINS,
  DECISION_SIDES,
  OUTCOME_SOURCES,
  type DecisionCycle,
  type DecisionOutcome,
  type DecisionPerformanceRow,
  type MarketSnapshot,
  type RepricerDecisionRecord,
  type VerificationSummary,
} from '../../../projects/core/src/lib/decision-journal';
import type {
  DecisionCyclesFilter,
  DecisionJournalRepository as CoreDecisionJournalRepository,
  DecisionPerformanceFilter,
} from '../../../projects/core/src/lib/decision-journal-repository';
import { InMemoryDecisionJournalRepository } from '../../../projects/core/src/lib/decision-journal-repository';
import type { RepricerDecision } from '../../../projects/core/src/lib/repricer';

// Compile-time parity gate. The adapter cannot `import` the core port (TS6059 under
// `electron/tsconfig.json` rootDir), so the local mirror it declares must be
// *structurally identical*. A direct return with no `as` is the check: if either side
// drifts, type-checking this file fails. It is a function rather than a value so
// importing this spec never opens a connection.
function _assertAdapterSatisfiesCorePort(db: DatabaseSync): CoreDecisionJournalRepository {
  return new SqliteDecisionJournalRepository(db);
}
void _assertAdapterSatisfiesCorePort;

/**
 * `DecisionAction` is `RepricerDecision['action']`, reused by the core journal rather
 * than redeclared. There is no exported array for it, so the schema list is pinned here
 * and `satisfies` proves it against the real union.
 */
const EXPECTED_DECISION_ACTIONS = [
  'UPDATE',
  'KEEP',
  'PAUSE',
] as const satisfies readonly RepricerDecision['action'][];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Frozen wall clock: 2026-02-03T12:00:00.000Z. */
const T0 = Date.parse('2026-02-03T12:00:00.000Z');
const MS_MINUTE = 60_000;

/** Every record the scripted run produces, plus every read the port exposes. */
interface Scenario {
  readonly snapshotA: MarketSnapshot;
  readonly snapshotB: MarketSnapshot;
  readonly cycle1: DecisionCycle;
  readonly cycle2: DecisionCycle;
  readonly closedCycle1: DecisionCycle;
  readonly d1: RepricerDecisionRecord;
  readonly d2: RepricerDecisionRecord;
  readonly d3: RepricerDecisionRecord;
  readonly o1: DecisionOutcome;
  readonly o2: DecisionOutcome;
  readonly oFailed: DecisionOutcome;
  readonly oSingleFill: DecisionOutcome;
  readonly reads: {
    readonly performance: DecisionPerformanceRow[][];
    readonly summaries: VerificationSummary[];
    readonly decisionsOfCycle1: RepricerDecisionRecord[];
    readonly outcomesOfD1: DecisionOutcome[];
    readonly allCycles: DecisionCycle[];
    readonly openCycles: DecisionCycle[];
    readonly cyclesByOrigin: DecisionCycle[];
  };
}

/**
 * The single source of truth for the fixtures. Every expected number asserted below is
 * derived from this data by hand and written next to the test, so a change in the
 * aggregation surfaces as a changed expectation instead of a silent pass.
 */
async function runScenario(repo: CoreDecisionJournalRepository): Promise<Scenario> {
  // snapshotA: fresh book, buy pressure. snapshotB: stale book, sell pressure.
  const snapshotA = await repo.appendMarketSnapshot({
    obi: 0.42,
    bidUsd: 26.5,
    askUsd: 27.0,
    nBids: 12,
    nAsks: 9,
    stale: false,
    fetchedAt: T0,
  });

  const snapshotB = await repo.appendMarketSnapshot({
    obi: -0.8,
    bidUsd: 26.0,
    askUsd: 26.4,
    nBids: 5,
    nAsks: 30,
    stale: true,
    fetchedAt: T0 + 1000,
  });

  const cycle1 = await repo.openCycle({
    origin: 'OPERATOR',
    capitalReservedUsdt: 500,
    title: 'Sesion 2026-02-03',
    openedAt: T0 + 2000,
  });

  const cycle2 = await repo.openCycle({
    origin: 'AUTO_ENGINE',
    capitalReservedUsdt: 250,
    openedAt: T0 + 3000,
  });

  // d1 and d2 belong to cycle1 (which gets closed); d3 belongs to cycle2 (stays OPEN).
  // Only d2 was taken on the stale snapshot -> staleDecisions = 1 of 3.
  const d1 = await repo.appendDecision({
    cycleId: cycle1.id,
    snapshotId: snapshotA.id,
    side: 'BUY',
    decisionPrice: 26.8,
    origin: 'OPERATOR',
    executionMode: 'PUBLISHING',
    action: 'UPDATE',
    modeledSpreadPct: 1.9,
    reason: 'Proyeccion de spread sobre el minimo',
    safetyFlags: ['SPREAD_BELOW_MINIMUM'],
    accountId: 'acc-banesco-01',
  });

  const d2 = await repo.appendDecision({
    cycleId: cycle1.id,
    snapshotId: snapshotB.id,
    side: 'SELL',
    decisionPrice: 26.2,
    origin: 'OPERATOR',
    executionMode: 'READ_ONLY',
    action: 'PAUSE',
    modeledSpreadPct: 0.4,
    reason: 'Libro incompleto',
  });

  const d3 = await repo.appendDecision({
    cycleId: cycle2.id,
    snapshotId: snapshotA.id,
    side: 'BUY',
    decisionPrice: 26.8,
    origin: 'AUTO_ENGINE',
    executionMode: 'READ_ONLY',
    action: 'KEEP',
    modeledSpreadPct: 1.9,
    reason: 'Sin cambios',
    planId: 'PLAN-001',
  });

  // d1 outcomes: two real fills with different notionals plus one failed publish.
  //   fillCount 3; filledAmount 100+300+0 = 400
  //   weighted spread (2*100 + 3*300) / 400 = 2.75   (plain mean would be 1.667)
  //   profit sum 1.8 + 6.0 = 7.8
  const o1 = await repo.appendOutcome({
    decisionId: d1.id,
    source: 'BINANCE_MERCHANT',
    success: true,
    filledAmountUsdt: 100,
    filledPrice: 26.9,
    realizedSpreadPct: 2.0,
    realizedProfitUsdt: 1.8,
    externalRef: 'ORDER-1',
    recordedAt: T0 + 10_000,
  });

  const o2 = await repo.appendOutcome({
    decisionId: d1.id,
    source: 'LOCAL_SIGNAL',
    success: true,
    filledAmountUsdt: 300,
    filledPrice: 27.0,
    realizedSpreadPct: 3.0,
    realizedProfitUsdt: 6.0,
    recordedAt: T0 + 20_000,
  });

  // A failed publish is a row, not silence: it counts as an outcome but reports nothing.
  const oFailed = await repo.appendOutcome({
    decisionId: d1.id,
    source: 'CSV_IMPORT',
    success: false,
    filledAmountUsdt: 0,
    detail: 'Merchant API rejected the ad',
    recordedAt: T0 + 30_000,
  });

  // d2 outcome: a single real fill, so no notional-weighting fallback is involved.
  // (The zero-notional plain-mean fallback is covered in the read-model suite, where both
  // adapters are asserted against it.)
  const oSingleFill = await repo.appendOutcome({
    decisionId: d2.id,
    source: 'MANUAL',
    success: true,
    filledAmountUsdt: 100,
    filledPrice: 26.4,
    realizedSpreadPct: 1.5,
    realizedProfitUsdt: 0,
    recordedAt: T0 + 40_000,
  });

  // Figures are the caller's, not an aggregate: the adapter must not recompute them.
  const closedCycle1 = await repo.closeCycle(cycle1.id, {
    status: 'CLOSED',
    closeReason: 'Sesion cerrada por el operador',
    realizedProfitUsdt: 7.8,
    realizedSpreadPct: 2.75,
    closedAt: T0 + 50_000,
  });

  const performanceFilters: (DecisionPerformanceFilter | undefined)[] = [
    undefined,
    { cycleId: cycle1.id },
    { cycleId: cycle2.id },
    { side: 'BUY' },
    { side: 'SELL' },
    { origin: 'OPERATOR' },
    { origin: 'AUTO_ENGINE' },
    { executionMode: 'PUBLISHING' },
    { executionMode: 'READ_ONLY' },
    { staleOnly: true },
    { verifiedOnly: true },
    { since: T0 + 2500 },
    { until: T0 + 2500 },
    { cycleId: cycle1.id, side: 'BUY', verifiedOnly: true },
    { cycleId: cycle1.id, origin: 'OPERATOR', staleOnly: true, since: T0 },
  ];

  const summaryFilters: (DecisionPerformanceFilter | undefined)[] = [
    undefined,
    { cycleId: cycle1.id },
    { cycleId: cycle2.id },
    { origin: 'OPERATOR' },
    { origin: 'AUTO_ENGINE' },
    { side: 'SELL' },
    { verifiedOnly: true },
    { staleOnly: true },
  ];

  const performance: DecisionPerformanceRow[][] = [];
  for (const filter of performanceFilters) {
    performance.push(await repo.getDecisionPerformance(filter));
  }

  const summaries: VerificationSummary[] = [];
  for (const filter of summaryFilters) {
    summaries.push(await repo.getVerificationSummary(filter));
  }

  const openFilter: DecisionCyclesFilter = { status: 'OPEN' };

  return {
    snapshotA,
    snapshotB,
    cycle1,
    cycle2,
    closedCycle1,
    d1,
    d2,
    d3,
    o1,
    o2,
    oFailed,
    oSingleFill,
    reads: {
      performance,
      summaries,
      decisionsOfCycle1: await repo.listDecisionsByCycle(cycle1.id),
      outcomesOfD1: await repo.listOutcomesByDecision(d1.id),
      allCycles: await repo.listCycles(),
      openCycles: await repo.listCycles(openFilter),
      cyclesByOrigin: await repo.listCycles({ origin: 'AUTO_ENGINE' }),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Parity with the in-memory reference adapter
// ---------------------------------------------------------------------------

describe('Decision Journal — SQLite adapter parity', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;
  let reference: InMemoryDecisionJournalRepository;

  beforeEach(() => {
    // Frozen clock: both adapters stamp rows with `Date.now()`, so a moving clock would
    // make the cycle-id suffix and every time filter differ for no reason.
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));

    repo = new SqliteDecisionJournalRepository(db);
    reference = new InMemoryDecisionJournalRepository();
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('returns identical records for the same write sequence', async () => {
    const sqlite = await runScenario(repo);
    const memory = await runScenario(reference);

    expect(sqlite.snapshotA).toEqual(memory.snapshotA);
    expect(sqlite.snapshotB).toEqual(memory.snapshotB);
    expect(sqlite.cycle1).toEqual(memory.cycle1);
    expect(sqlite.cycle2).toEqual(memory.cycle2);
    expect(sqlite.closedCycle1).toEqual(memory.closedCycle1);
    expect(sqlite.d1).toEqual(memory.d1);
    expect(sqlite.d2).toEqual(memory.d2);
    expect(sqlite.d3).toEqual(memory.d3);
    expect(sqlite.o1).toEqual(memory.o1);
    expect(sqlite.o2).toEqual(memory.o2);
    expect(sqlite.oFailed).toEqual(memory.oFailed);
    expect(sqlite.oSingleFill).toEqual(memory.oSingleFill);

    expect(sqlite.reads.performance).toEqual(memory.reads.performance);
    expect(sqlite.reads.summaries).toEqual(memory.reads.summaries);
    expect(sqlite.reads.decisionsOfCycle1).toEqual(memory.reads.decisionsOfCycle1);
    expect(sqlite.reads.outcomesOfD1).toEqual(memory.reads.outcomesOfD1);
    expect(sqlite.reads.allCycles).toEqual(memory.reads.allCycles);
    expect(sqlite.reads.openCycles).toEqual(memory.reads.openCycles);
    expect(sqlite.reads.cyclesByOrigin).toEqual(memory.reads.cyclesByOrigin);
  });

  it('rejects the same invalid writes with the same flat errors', async () => {
    const probes = (r: CoreDecisionJournalRepository) => [
      () =>
        r.appendDecision({
          cycleId: 'cycle_does_not_exist',
          snapshotId: 1,
          side: 'BUY',
          decisionPrice: 1,
          origin: 'OPERATOR',
          executionMode: 'READ_ONLY',
          action: 'KEEP',
          modeledSpreadPct: 1,
          reason: 'r',
        }),
      () =>
        r.closeCycle('cycle_does_not_exist', {
          status: 'CLOSED',
          closeReason: 'r',
          realizedProfitUsdt: 0,
          realizedSpreadPct: 0,
        }),
      () =>
        r.appendOutcome({
          decisionId: 4242,
          source: 'MANUAL',
          success: true,
          filledAmountUsdt: 0,
        }),
    ];

    const collect = async (r: CoreDecisionJournalRepository): Promise<string[]> => {
      const messages: string[] = [];
      for (const probe of probes(r)) {
        // Flat `Error`, prefixed, no driver-specific wrapper.
        await expect(probe()).rejects.toThrow(/^decision_journal:/);
        await probe().catch((err: Error) => messages.push(err.message));
      }
      return messages;
    };

    const sqliteErrors = await collect(repo);
    const memoryErrors = await collect(reference);

    expect(sqliteErrors).toEqual(memoryErrors);
    expect(sqliteErrors).toEqual([
      'decision_journal: unknown cycle "cycle_does_not_exist"',
      'decision_journal: unknown cycle "cycle_does_not_exist"',
      'decision_journal: unknown decision 4242',
    ]);
  });

  it('rejects a decision whose snapshot does not exist', async () => {
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    await expect(
      repo.appendDecision({
        cycleId: cycle.id,
        snapshotId: 999,
        side: 'BUY',
        decisionPrice: 1,
        origin: 'OPERATOR',
        executionMode: 'READ_ONLY',
        action: 'KEEP',
        modeledSpreadPct: 0,
        reason: 'r',
      }),
    ).rejects.toThrow('decision_journal: unknown market snapshot 999');
  });

  it('keeps id generation monotonic per table, starting at 1', async () => {
    const s1 = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const s2 = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    expect([s1.id, s2.id]).toEqual([1, 2]);

    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    expect(cycle.id).toBe(`cycle_${T0}_1`);
    const cycleB = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    expect(cycleB.id).toBe(`cycle_${T0}_2`);

    const d1 = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: s1.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    const d2 = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: s2.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    expect([d1.id, d2.id]).toEqual([1, 2]);

    const o1 = await repo.appendOutcome({
      decisionId: d1.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 0,
    });
    const o2 = await repo.appendOutcome({
      decisionId: d1.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 0,
    });
    expect([o1.id, o2.id]).toEqual([1, 2]);
  });

  it('defaults omitted timestamps and optional fields like the reference adapter', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    expect(snapshot.fetchedAt).toBe(T0);
    expect(snapshot.createdAt).toBe(T0);

    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    expect(decision.safetyFlags).toEqual([]);
    expect(decision.accountId).toBeUndefined();
    expect(decision.planId).toBeUndefined();

    const outcome = await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 0,
    });
    expect(outcome.filledPrice).toBeNull();
    expect(outcome.realizedSpreadPct).toBeNull();
    expect(outcome.realizedProfitUsdt).toBeNull();
    expect(outcome.externalRef).toBeNull();
    expect(outcome.detail).toBeNull();
    expect(outcome.recordedAt).toBe(T0);
    expect(outcome.createdAt).toBe(T0);
  });
});

// ---------------------------------------------------------------------------
// 2. Referential integrity
// ---------------------------------------------------------------------------

describe('Decision Journal — referential integrity', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => db.close());

  it('enforces hard foreign keys at the SQLite level, not only in the adapter', () => {
    // Bypasses the adapter entirely: SQLite itself must reject the dangling reference.
    expect(() =>
      db
        .prepare(
          `INSERT INTO repricer_decisions (
             cycle_id, snapshot_id, side, action, decision_price, origin, execution_mode,
             modeled_spread_pct, reason, safety_flags_json,
             observed_obi, observed_bid_usd, observed_ask_usd, observed_stale, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'cycle_not_there',
          1,
          'BUY',
          'KEEP',
          1,
          'OPERATOR',
          'READ_ONLY',
          0,
          'r',
          '[]',
          0,
          1,
          1,
          0,
          T0,
        ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects an outcome pointing at a missing decision at the SQLite level', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO decision_outcomes (
             decision_id, source, success, filled_amount_usdt, recorded_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(777, 'MANUAL', 1, 0, T0, T0),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('accepts a decision whose cycle and snapshot both exist', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'SELL',
      decisionPrice: 2,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'ok',
    });
    expect(decision.cycleId).toBe(cycle.id);
    expect(decision.snapshotId).toBe(snapshot.id);
  });
});

// ---------------------------------------------------------------------------
// 3. Append-only surface
// ---------------------------------------------------------------------------

describe('Decision Journal — append-only surface', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => db.close());

  it('exposes no update or delete method for decisions, outcomes or snapshots', () => {
    const surface = SqliteDecisionJournalRepository.prototype as unknown as Record<string, unknown>;
    for (const forbidden of [
      'updateDecision',
      'deleteDecision',
      'updateOutcome',
      'deleteOutcome',
      'updateSnapshot',
      'deleteSnapshot',
      'updateMarketSnapshot',
      'deleteMarketSnapshot',
    ]) {
      expect(surface[forbidden], `${forbidden} must not exist on an append-only journal`).toBeUndefined();
    }
  });

  it('never rewrites an existing row when a second append happens', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0.1,
      bidUsd: 1,
      askUsd: 1.1,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    const first = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1.05,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'primera',
    });
    await repo.appendOutcome({
      decisionId: first.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 5,
    });
    await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'SELL',
      decisionPrice: 1.2,
      origin: 'AUTO_ENGINE',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 2,
      reason: 'segunda',
    });

    expect((await repo.getDecision(first.id))?.reason).toBe('primera');
    expect(await repo.listOutcomesByDecision(first.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Cycle lifecycle: the only mutable record
// ---------------------------------------------------------------------------

describe('Decision Journal — cycle lifecycle', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('refuses to close a cycle that already reached a terminal status', async () => {
    const close = (status: 'CLOSED' | 'ABANDONED') => ({
      status,
      closeReason: 'motivo',
      realizedProfitUsdt: 0,
      realizedSpreadPct: 0,
    });

    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    await repo.closeCycle(cycle.id, close('CLOSED'));
    await expect(repo.closeCycle(cycle.id, close('CLOSED'))).rejects.toThrow(
      `decision_journal: cycle "${cycle.id}" is already CLOSED and cannot be closed again`,
    );
    await expect(repo.closeCycle(cycle.id, close('ABANDONED'))).rejects.toThrow(
      /is already CLOSED and cannot be closed again/,
    );

    const abandoned = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    await repo.closeCycle(abandoned.id, close('ABANDONED'));
    await expect(repo.closeCycle(abandoned.id, close('CLOSED'))).rejects.toThrow(
      /is already ABANDONED and cannot be closed again/,
    );
  });

  it('persists the caller-supplied figures instead of aggregating outcomes', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 100,
      realizedSpreadPct: 99,
      realizedProfitUsdt: 42,
    });

    // Deliberately different from what the outcome says: the port persists figures,
    // it never adds outcomes behind the caller's back.
    const closed = await repo.closeCycle(cycle.id, {
      status: 'CLOSED',
      closeReason: 'cifras del operador',
      realizedProfitUsdt: 1.5,
      realizedSpreadPct: 0.25,
      closedAt: T0 + 999,
    });

    expect(closed.realizedProfitUsdt).toBe(1.5);
    expect(closed.realizedSpreadPct).toBe(0.25);
    expect(closed.closedAt).toBe(T0 + 999);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closeReason).toBe('cifras del operador');
    expect(closed.openedAt).toBe(T0);
    expect((await repo.getCycle(cycle.id))?.realizedProfitUsdt).toBe(1.5);
  });

  it('keeps the realized columns null and the title undefined while the cycle is open', async () => {
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    expect(cycle.status).toBe('OPEN');
    expect(cycle.title).toBeUndefined();
    expect(cycle.realizedProfitUsdt).toBeNull();
    expect(cycle.realizedSpreadPct).toBeNull();
    expect(cycle.closeReason).toBeNull();
    expect(cycle.closedAt).toBeNull();
  });

  it('returns null for a cycle that does not exist', async () => {
    expect(await repo.getCycle('cycle_nope')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Observed context is copied, never claimed
// ---------------------------------------------------------------------------

describe('Decision Journal — observed context', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => db.close());

  it('copies observed* from the referenced snapshot, ignoring caller claims', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: -0.25,
      bidUsd: 26.1,
      askUsd: 26.9,
      nBids: 7,
      nAsks: 3,
      stale: true,
      fetchedAt: T0,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });

    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'SELL',
      decisionPrice: 27.5,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'PAUSE',
      modeledSpreadPct: 3,
      reason: 'r',
    });

    expect(decision.observedObi).toBe(-0.25);
    expect(decision.observedBidUsd).toBe(26.1);
    expect(decision.observedAskUsd).toBe(26.9);
    expect(decision.observedStale).toBe(true);

    // A second decision on the same snapshot must observe the same evidence.
    const again = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'AUTO_ENGINE',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 0,
      reason: 'r2',
    });
    expect(again.observedObi).toBe(decision.observedObi);
    expect(again.observedStale).toBe(decision.observedStale);
  });
});

// ---------------------------------------------------------------------------
// 6. Read model: LEFT JOIN and notional-weighted spread
// ---------------------------------------------------------------------------

describe('Decision Journal — decision_performance read model', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;
  let reference: InMemoryDecisionJournalRepository;

  /** One snapshot + one open cycle, ready to receive decisions. */
  async function scaffold() {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    return { snapshot, cycle, decision };
  }

  beforeEach(() => {
    // Frozen clock: the parity test below deep-equals rows that carry `cycleId` (built
    // from `Date.now()`) and `decidedAt`, so a moving clock would fail for no reason.
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
    reference = new InMemoryDecisionJournalRepository();
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('keeps a decision with zero outcomes (LEFT JOIN, never INNER)', async () => {
    const { decision } = await scaffold();

    const rows = await repo.getDecisionPerformance();
    expect(rows).toHaveLength(1);
    expect(rows[0].decisionId).toBe(decision.id);
    expect(rows[0].fillCount).toBe(0);
    expect(rows[0].realizedSpreadPct).toBeNull();
    expect(rows[0].realizedProfitUsdt).toBeNull();
    expect(rows[0].filledAmountUsdt).toBeNull();
    expect(rows[0].decidedAt).toBe(decision.createdAt);

    // ... and it drops out only when the caller asks for verified decisions.
    expect(await repo.getDecisionPerformance({ verifiedOnly: true })).toHaveLength(0);
  });

  it('computes the notional-weighted mean spread, not the plain mean', async () => {
    const { decision } = await scaffold();
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'BINANCE_MERCHANT',
      success: true,
      filledAmountUsdt: 100,
      realizedSpreadPct: 2.0,
      realizedProfitUsdt: 1.8,
    });
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'LOCAL_SIGNAL',
      success: true,
      filledAmountUsdt: 300,
      realizedSpreadPct: 3.0,
      realizedProfitUsdt: 6.0,
    });

    const [row] = await repo.getDecisionPerformance();
    // Weighted: (2*100 + 3*300)/400 = 2.75. Plain mean would be 2.5.
    expect(row.realizedSpreadPct).toBeCloseTo(2.75, 10);
    expect(row.realizedSpreadPct).not.toBeCloseTo(2.5, 10);
    expect(row.realizedProfitUsdt).toBeCloseTo(7.8, 10);
    expect(row.filledAmountUsdt).toBe(400);
    expect(row.fillCount).toBe(2);
  });

  it('falls back to the plain mean when every reporting outcome filled 0', async () => {
    const { decision } = await scaffold();
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 0,
      realizedSpreadPct: 1.0,
      realizedProfitUsdt: 0,
    });
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 0,
      realizedSpreadPct: 2.0,
      realizedProfitUsdt: 0,
    });

    const [row] = await repo.getDecisionPerformance();
    // Notional total is 0 -> plain mean of the two reported spreads: 1.5.
    expect(row.realizedSpreadPct).toBeCloseTo(1.5, 10);
    expect(row.filledAmountUsdt).toBe(0);
    expect(row.fillCount).toBe(2);
  });

  it('ignores outcomes that report no spread, and stays null when none does', async () => {
    const { decision } = await scaffold();
    // A failed publish: counted as an outcome, but it reports no spread and no profit.
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: false,
      filledAmountUsdt: 0,
      detail: 'rechazado',
    });

    const [row] = await repo.getDecisionPerformance();
    expect(row.fillCount).toBe(1);
    expect(row.realizedSpreadPct).toBeNull();
    expect(row.realizedProfitUsdt).toBeNull();
    expect(row.filledAmountUsdt).toBe(0);
  });

  it('records a failed publish as a row, never as silence', async () => {
    const { decision } = await scaffold();
    const failed = await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: false,
      filledAmountUsdt: 0,
      detail: 'merchant 400',
    });

    expect(failed.success).toBe(false);
    expect(failed.detail).toBe('merchant 400');
    expect(await repo.listOutcomesByDecision(decision.id)).toHaveLength(1);
  });

  it('returns decisions in insertion order', async () => {
    const { cycle, snapshot } = await scaffold();
    for (const price of [2, 3, 4]) {
      await repo.appendDecision({
        cycleId: cycle.id,
        snapshotId: snapshot.id,
        side: 'BUY',
        decisionPrice: price,
        origin: 'OPERATOR',
        executionMode: 'READ_ONLY',
        action: 'KEEP',
        modeledSpreadPct: 1,
        reason: `r${price}`,
      });
    }
    // scaffold() already appended the first decision, so there are four in total.
    const rows = await repo.getDecisionPerformance();
    expect(rows.map((r) => r.decisionId)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.decisionPrice)).toEqual([1, 2, 3, 4]);
  });

  /**
   * Parity for the two branches of the read-model spread aggregation.
   *
   * `DecisionPerformanceRow.realizedSpreadPct` documents one contract: the
   * notional-weighted mean when there is notional, the plain mean when every reporting
   * outcome filled 0, and null when none reports one. Both adapters must implement
   * exactly that for the same write sequence.
   *
   * The zero-notional branch used to be a known divergence: this adapter implemented the
   * documented plain mean while `InMemoryDecisionJournalRepository.weightedSpreadPct`
   * returned `weighted / reported.length`, which collapses to 0 when the notional is 0.
   * Core is now corrected, so the guard is parity rather than a divergence report — and
   * the weighted branch is asserted here too, so a "fix" that made every case a plain
   * mean would fail instead of passing.
   */
  it('matches the reference adapter on the zero-notional fallback and the weighted mean', async () => {
    interface ReportedFill {
      readonly filledAmountUsdt: number;
      readonly realizedSpreadPct: number;
    }

    /**
     * Same scaffold and same outcomes on either adapter, so the aggregation is the only
     * thing that can make the two rows differ.
     */
    const rowFor = async (
      r: CoreDecisionJournalRepository,
      outcomes: readonly ReportedFill[],
    ): Promise<DecisionPerformanceRow> => {
      const snapshot = await r.appendMarketSnapshot({
        obi: 0,
        bidUsd: 1,
        askUsd: 2,
        nBids: 1,
        nAsks: 1,
        stale: false,
      });
      const cycle = await r.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
      const decision = await r.appendDecision({
        cycleId: cycle.id,
        snapshotId: snapshot.id,
        side: 'BUY',
        decisionPrice: 1,
        origin: 'OPERATOR',
        executionMode: 'PUBLISHING',
        action: 'UPDATE',
        modeledSpreadPct: 1,
        reason: 'r',
      });
      for (const fill of outcomes) {
        await r.appendOutcome({
          decisionId: decision.id,
          source: 'CSV_IMPORT',
          success: true,
          filledAmountUsdt: fill.filledAmountUsdt,
          realizedSpreadPct: fill.realizedSpreadPct,
          realizedProfitUsdt: 0,
        });
      }
      // Scoped to the cycle just created, so a second call on the same adapter cannot
      // silently read the first call's row.
      const rows = await r.getDecisionPerformance({ cycleId: cycle.id });
      expect(rows).toHaveLength(1);
      return rows[0];
    };

    // Branch 1: every reporting outcome filled 0, so the notional carries no information
    // and the contract is the plain mean (1 + 2) / 2 = 1.5. Reporting 0 here would be a
    // number no consumer could tell apart from "we really captured nothing".
    const zeroNotional: readonly ReportedFill[] = [
      { filledAmountUsdt: 0, realizedSpreadPct: 1.0 },
      { filledAmountUsdt: 0, realizedSpreadPct: 2.0 },
    ];
    const sqliteZero = await rowFor(repo, zeroNotional);
    const memoryZero = await rowFor(reference, zeroNotional);

    expect(sqliteZero.realizedSpreadPct).toBe(1.5);
    expect(memoryZero.realizedSpreadPct).toBe(1.5);
    expect(sqliteZero).toEqual(memoryZero);

    // Branch 2: real notional, so the weighting survives: (2*100 + 3*300) / 400 = 2.75.
    const weighted: readonly ReportedFill[] = [
      { filledAmountUsdt: 100, realizedSpreadPct: 2.0 },
      { filledAmountUsdt: 300, realizedSpreadPct: 3.0 },
    ];
    const sqliteWeighted = await rowFor(repo, weighted);
    const memoryWeighted = await rowFor(reference, weighted);

    expect(sqliteWeighted.realizedSpreadPct).toBe(2.75);
    expect(memoryWeighted.realizedSpreadPct).toBe(2.75);
    expect(sqliteWeighted).toEqual(memoryWeighted);
  });
});

// ---------------------------------------------------------------------------
// 7. Verification summary
// ---------------------------------------------------------------------------

describe('Decision Journal — getVerificationSummary', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('returns zeros for an empty journal instead of NaN', async () => {
    expect(await repo.getVerificationSummary()).toEqual({
      totalDecisions: 0,
      verifiedDecisions: 0,
      verificationRate: 0,
      staleDecisions: 0,
      staleRate: 0,
      openCycles: 0,
      decisionsAwaitingOutcome: 0,
    });
  });

  it('rounds rates to 4 decimals and counts the verification backlog', async () => {
    await runScenario(repo);

    // 3 decisions; d1 and d2 have outcomes, d3 has none; only d2 is stale;
    // cycle1 is CLOSED and cycle2 is OPEN.
    expect(await repo.getVerificationSummary()).toEqual({
      totalDecisions: 3,
      verifiedDecisions: 2,
      verificationRate: 0.6667,
      staleDecisions: 1,
      staleRate: 0.3333,
      openCycles: 1,
      decisionsAwaitingOutcome: 1,
    });
  });

  it('keeps openCycles bound to the cycle filters only', async () => {
    const { cycle1, cycle2 } = await runScenario(repo);

    // 1/1 and 1/1 are exact ratios: no rounding noise.
    expect((await repo.getVerificationSummary({ staleOnly: true })).verificationRate).toBe(1);
    expect((await repo.getVerificationSummary({ staleOnly: true })).staleRate).toBe(1);

    // `side` addresses decisions only: it must NOT change the open-cycle count.
    const bySide = await repo.getVerificationSummary({ side: 'SELL' });
    expect(bySide.totalDecisions).toBe(1);
    expect(bySide.openCycles).toBe(1);

    // `origin` describes a cycle too, so it does filter openCycles.
    expect((await repo.getVerificationSummary({ origin: 'AUTO_ENGINE' })).openCycles).toBe(1);
    expect((await repo.getVerificationSummary({ origin: 'OPERATOR' })).openCycles).toBe(0);

    // `cycleId` narrows to that one cycle.
    expect((await repo.getVerificationSummary({ cycleId: cycle2.id })).openCycles).toBe(1);
    expect((await repo.getVerificationSummary({ cycleId: cycle1.id })).openCycles).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Retention: market_snapshots is the only prunable table
// ---------------------------------------------------------------------------

describe('Decision Journal — market_snapshots retention', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => db.close());

  it('exposes an index on fetched_at for the purge', () => {
    const plan = db
      .prepare('EXPLAIN QUERY PLAN DELETE FROM market_snapshots WHERE fetched_at < ?')
      .all(1) as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_market_snapshots_fetched_at');
  });

  it('deletes only rows strictly older than the cutoff', async () => {
    const old = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0,
    });
    const fresh = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0 + 200 * MS_MINUTE,
    });

    expect(purgeMarketSnapshotsBefore(db, T0 + 90 * MS_MINUTE)).toBe(1);
    const remaining = db.prepare('SELECT id FROM market_snapshots ORDER BY id').all() as {
      id: number;
    }[];
    expect(remaining.map((r) => r.id)).toEqual([fresh.id]);
    expect(old.id).toBeLessThan(fresh.id);
  });

  it('never deletes a snapshot a decision still cites (hard FK is the guarantee)', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 1,
      reason: 'r',
    });

    expect(purgeMarketSnapshotsBefore(db, T0 + 200 * MS_MINUTE)).toBe(0);
    const remaining = db.prepare('SELECT id FROM market_snapshots').all() as { id: number }[];
    expect(remaining).toEqual([{ id: snapshot.id }]);
  });

  it('leaves the append-only tables alone', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0,
    });
    const cycle = await repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'r',
    });
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'MANUAL',
      success: true,
      filledAmountUsdt: 10,
    });

    // Two unreferenced snapshots get pruned; nothing else moves.
    await repo.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0,
    });
    purgeMarketSnapshotsBefore(db, T0 + 200 * MS_MINUTE);

    expect(await repo.getDecisionPerformance()).toHaveLength(1);
    expect(await repo.listOutcomesByDecision(decision.id)).toHaveLength(1);
    expect(await repo.listCycles()).toHaveLength(1);
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('repricer_decisions')).toBe(1);
    expect(count('decision_outcomes')).toBe(1);
    expect(count('decision_cycles')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. schema.sql is derived from the core enum arrays
// ---------------------------------------------------------------------------

describe('Decision Journal — schema.sql', () => {
  const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8');

  /** Body of a `CREATE TABLE` block, so a column check cannot leak across tables. */
  function tableBody(table: string): string {
    const start = schemaSql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    expect(start, `schema.sql is missing table ${table}`).toBeGreaterThan(-1);
    const end = schemaSql.indexOf('\n);', start);
    expect(end, `unterminated CREATE TABLE ${table}`).toBeGreaterThan(start);
    return schemaSql.slice(start, end);
  }

  /** Quoted literal list of `column IN (...)` inside one table. */
  function checkLiterals(table: string, column: string): string[] {
    const line = tableBody(table)
      .split('\n')
      .find((l) => new RegExp(`^\\s*${column}\\s+TEXT\\b`).test(l) && l.includes('IN ('));
    expect(line, `no CHECK for ${table}.${column} in schema.sql`).toBeDefined();
    const inMatch = new RegExp('IN\\s*\\(([^)]*)\\)').exec(line as string);
    expect(inMatch, `no IN (...) list for ${table}.${column}`).not.toBeNull();
    return [...(inMatch as RegExpExecArray)[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  }

  it('derives every enum CHECK from the arrays exported by the core journal module', () => {
    // Single source of truth: projects/core/src/lib/decision-journal.ts. These are
    // literal copies because electron/tsconfig.json cannot import from projects/core,
    // and this test is what proves the copies have not drifted.
    expect(checkLiterals('repricer_decisions', 'side')).toEqual([...DECISION_SIDES]);
    expect(checkLiterals('decision_cycles', 'status')).toEqual([...DECISION_CYCLE_STATUSES]);
    expect(checkLiterals('decision_cycles', 'origin')).toEqual([...DECISION_ORIGINS]);
    expect(checkLiterals('repricer_decisions', 'origin')).toEqual([...DECISION_ORIGINS]);
    expect(checkLiterals('repricer_decisions', 'execution_mode')).toEqual([
      ...DECISION_EXECUTION_MODES,
    ]);
    expect(checkLiterals('decision_outcomes', 'source')).toEqual([...OUTCOME_SOURCES]);
    // `action` has no exported array: it is RepricerDecision['action'] from the repricer.
    expect(checkLiterals('repricer_decisions', 'action')).toEqual([...EXPECTED_DECISION_ACTIONS]);
  });

  it('names the core module as the source of truth for the CHECK lists', () => {
    expect(schemaSql).toContain('projects/core/src/lib/decision-journal.ts');
    expect(schemaSql).toContain('projects/core/src/lib/repricer.ts');
  });

  it('declares exactly the journal objects and the read model view', () => {
    for (const object of [
      'market_snapshots',
      'decision_cycles',
      'repricer_decisions',
      'decision_outcomes',
    ]) {
      expect(schemaSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${object}\\b`));
    }
    expect(schemaSql).toMatch(/CREATE VIEW IF NOT EXISTS decision_performance\b/);
  });

  it('is idempotent, so applySchema() is safe on an existing database', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => {
      db.exec(schemaSql);
      db.exec(schemaSql);
    }).not.toThrow();
    db.close();
  });

  it('rejects an unknown enum literal at the SQLite level', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(schemaSql);
    const insertCycle = (id: string, status: string, origin: string) =>
      db
        .prepare(
          `INSERT INTO decision_cycles
             (id, status, origin, capital_reserved_usdt, opened_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, status, origin, 1, T0, T0, T0);

    expect(() => insertCycle('c1', 'PAUSED', 'OPERATOR')).toThrow(/CHECK constraint failed/);
    expect(() => insertCycle('c2', 'OPEN', 'ROBOT')).toThrow(/CHECK constraint failed/);
    expect(() => insertCycle('c3', 'OPEN', 'OPERATOR')).not.toThrow();
    db.close();
  });

  it('stores enums as TEXT and booleans as 0/1 with a CHECK', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(schemaSql);
    const cycleId = `cycle_${T0}_1`;
    db.prepare(
      `INSERT INTO decision_cycles
         (id, status, origin, capital_reserved_usdt, opened_at, created_at, updated_at)
       VALUES (?, 'OPEN', 'OPERATOR', 1, ?, ?, ?)`,
    ).run(cycleId, T0, T0, T0);
    const snapshotId = Number(
      db
        .prepare(
          `INSERT INTO market_snapshots
             (obi, bid_usd, ask_usd, n_bids, n_asks, stale, fetched_at, created_at)
           VALUES (0, 1, 2, 1, 1, 0, ?, ?)`,
        )
        .run(T0, T0).lastInsertRowid,
    );
    expect(
      () =>
        db
          .prepare(
            `INSERT INTO repricer_decisions
               (cycle_id, snapshot_id, side, action, decision_price, origin, execution_mode,
                modeled_spread_pct, reason, safety_flags_json,
                observed_obi, observed_bid_usd, observed_ask_usd, observed_stale, created_at)
             VALUES (?, ?, 'BUY', 'KEEP', 1, 'OPERATOR', 'READ_ONLY', 0, 'r', '[]', 0, 1, 1, 2, ?)`,
          )
          .run(cycleId, snapshotId, T0),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// 10. Production wiring: the real P2PDatabaseService resolves the journal
// ---------------------------------------------------------------------------

describe('Decision Journal — P2PDatabaseService wiring', () => {
  const testDbPath = path.resolve(__dirname, '../../../../scratch/journal_wiring.sqlite');
  let service: P2PDatabaseService;

  beforeEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${testDbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    service = new P2PDatabaseService(testDbPath);
  });

  afterEach(() => {
    service.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${testDbPath}${suffix}`;
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // Ignored
        }
      }
    }
  });

  it('exposes a journal bound to the migrated schema on the real service', async () => {
    const journal = service.getDecisionJournal();
    expect(await journal.getVerificationSummary()).toMatchObject({
      totalDecisions: 0,
      openCycles: 0,
    });

    const snapshot = await journal.appendMarketSnapshot({
      obi: 0.1,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
    });
    const cycle = await journal.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 10 });
    const decision = await journal.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1,
      reason: 'r',
    });

    expect(decision.observedObi).toBe(0.1);
    expect(await journal.getVerificationSummary()).toMatchObject({
      totalDecisions: 1,
      verifiedDecisions: 0,
      openCycles: 1,
      decisionsAwaitingOutcome: 1,
    });

    // Same underlying connection: a write through the journal is visible to a read.
    expect(service.getDecisionJournal()).toBe(journal);
  });

  it('purges old snapshots through the service without touching the journal', async () => {
    const journal = service.getDecisionJournal();
    const snapshot = await journal.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0 - 30 * 24 * MS_MINUTE,
    });
    const cycle = await journal.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 });
    await journal.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 1,
      origin: 'OPERATOR',
      executionMode: 'READ_ONLY',
      action: 'KEEP',
      modeledSpreadPct: 1,
      reason: 'r',
    });

    // Referenced snapshot survives; an unreferenced old one does not.
    await journal.appendMarketSnapshot({
      obi: 0,
      bidUsd: 1,
      askUsd: 2,
      nBids: 1,
      nAsks: 1,
      stale: false,
      fetchedAt: T0 - 40 * 24 * MS_MINUTE,
    });
    expect(service.purgeMarketSnapshotsBefore(T0 - 7 * 24 * MS_MINUTE)).toBe(1);
    expect(await journal.getDecisionPerformance()).toHaveLength(1);
  });
});
