/**
 * End-to-end Decision Journal on REAL SQLite.
 *
 * `decision-journal.repository.spec.ts` is the parity contract (SQLite answers exactly
 * what the in-memory adapter answers). This file is the other half: it runs the journal
 * the way production runs it — a real file on disk, the real `schema.sql`, the real
 * `P2PDatabaseService` wiring, the real adapter — and asks the questions the parity spec
 * cannot answer:
 *
 *  - Does the whole chain survive a real connection (cycle → snapshot → decision →
 *    outcomes), including the pragmas and the migration `applySchema` runs?
 *  - Are foreign keys ACTUALLY enforced on the connection production opens, or only in
 *    a test that remembered to turn them on?
 *  - What happens to the rows when a write is rejected?
 *
 * Rules this file holds itself to:
 *
 *  - **No doubles, no in-memory adapter, no fakes.** The database is SQLite on a real
 *    file. A test that fakes storage proves nothing about storage.
 *  - **OBI is consumed, never re-implemented.** The snapshot's imbalance comes from the
 *    real `calculateOrderBookImbalance` applied to a real two-sided depth.
 *  - **The dangling-reference case is asserted at the SQL level too**, bypassing the
 *    adapter entirely, because the adapter's own pre-check is a courtesy: the resistance
 *    that matters is the one SQLite provides even if the adapter is wrong.
 *
 * One honest limitation, stated here instead of hidden: append-only is a PORT contract
 * (`schema.sql` has no triggers), so it is asserted where it is actually enforced — on
 * the adapter's method surface and on the defensive copies the reads hand out. Raw SQL
 * could still rewrite a row, and no test here pretends otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDecisionJournalRepository } from './decision-journal.repository';
import { P2PDatabaseService } from './database';
import { calculateOrderBookImbalance } from '../../../projects/core/src/lib/orderbook-imbalance';
// Declared in binance-p2p, not re-exported by orderbook-imbalance.
import type { BinanceOfferSummary } from '../../../projects/core/src/lib/binance-p2p';
import { realizedCycleFigures } from '../../../projects/core/src/lib/decision-journal-repository';
import { buildDecisionSelfAudit } from '../../../projects/core/src/lib/decision-journal-audit';
import type { DecisionJournalRepository } from './decision-journal.repository';

const T0 = Date.parse('2026-02-03T12:00:00.000Z');
const DB_FILE = path.resolve(__dirname, '../../scratch/journal-integration.sqlite');

/** Two-sided depth wide enough to clear the default 10 VES floor, in VES. */
const BUY_OFFERS: BinanceOfferSummary[] = [
  { advNo: 'b1', price: 960, merchantName: 'CompradorUno', finishRatePct: 99, orderCount: 300, minVes: 100, maxVes: 20000, payMethods: ['Banesco'] },
  { advNo: 'b2', price: 959, merchantName: 'CompradorDos', finishRatePct: 99, orderCount: 120, minVes: 100, maxVes: 15000, payMethods: ['Banesco'] },
];
const SELL_OFFERS: BinanceOfferSummary[] = [
  { advNo: 'a1', price: 985, merchantName: 'VendedorUno', finishRatePct: 99, orderCount: 300, minVes: 100, maxVes: 20000, payMethods: ['Banesco'] },
  { advNo: 'a2', price: 987, merchantName: 'VendedorDos', finishRatePct: 99, orderCount: 120, minVes: 100, maxVes: 15000, payMethods: ['Banesco'] },
];

/** Raw row count straight from SQLite, bypassing the adapter. */
function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

describe('Decision Journal — end-to-end on real SQLite (production wiring)', () => {
  let service: P2PDatabaseService;
  let journal: DecisionJournalRepository;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
    }
    service = new P2PDatabaseService(DB_FILE);
    journal = service.getDecisionJournal();
  });

  afterEach(() => {
    service.close();
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
    }
    vi.useRealTimers();
  });

  /**
   * Reaches the connection production uses. `db` is `private` in TypeScript terms only,
   * and the point of this spec is to assert on THAT connection: proving foreign keys on a
   * connection the test opened itself would prove nothing about the one the app opens.
   * Production code is not widened with a getter just to satisfy a test.
   */
  function productionConnection(): DatabaseSync {
    return (service as unknown as { db: DatabaseSync }).db;
  }

  it('has foreign keys actually enabled on the connection production opens', () => {
    const row = productionConnection().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(Number(row.foreign_keys)).toBe(1);
  });

  it('survives the whole chain and reports what the read model promises', async () => {
    // --- cycle -------------------------------------------------------------
    const cycle = await journal.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 500 });
    expect(cycle.status).toBe('OPEN');

    // --- two snapshots, one fresh and one already stale --------------------
    // The OBI is COMPUTED by the real engine from a real depth, not re-derived here.
    const freshObi = calculateOrderBookImbalance(BUY_OFFERS, SELL_OFFERS, {
      depthLevels: 2,
      minOrderUsdt: 20,
    });
    const staleObi = calculateOrderBookImbalance(SELL_OFFERS, BUY_OFFERS, {
      depthLevels: 2,
      minOrderUsdt: 20,
    });
    expect(freshObi.obiRatio).not.toBe(staleObi.obiRatio);

    const freshSnapshot = await journal.appendMarketSnapshot({
      obi: freshObi.obiRatio,
      bidUsd: 960 / 385,
      askUsd: 985 / 385,
      nBids: BUY_OFFERS.length,
      nAsks: SELL_OFFERS.length,
      stale: false,
      fetchedAt: T0,
    });
    const staleSnapshot = await journal.appendMarketSnapshot({
      obi: staleObi.obiRatio,
      bidUsd: 987 / 385,
      askUsd: 959 / 385,
      nBids: BUY_OFFERS.length,
      nAsks: SELL_OFFERS.length,
      stale: true,
      fetchedAt: T0,
    });

    // --- two decisions, one per snapshot -----------------------------------
    const buy = await journal.appendDecision({
      cycleId: cycle.id,
      snapshotId: freshSnapshot.id,
      side: 'BUY',
      decisionPrice: 385.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'READ_ONLY',
      action: 'UPDATE',
      modeledSpreadPct: 1.2,
      reason: 'Repriced to hold Top 1',
    });
    const sell = await journal.appendDecision({
      cycleId: cycle.id,
      snapshotId: staleSnapshot.id,
      side: 'SELL',
      decisionPrice: 385.2,
      origin: 'AUTO_ENGINE',
      executionMode: 'READ_ONLY',
      action: 'UPDATE',
      modeledSpreadPct: 1.4,
      reason: 'Repriced to hold Top 1',
    });

    // The observed context is COPIED from the referenced snapshot, so the decision taken
    // on the stale book must carry the stale book's evidence, not the fresh one's.
    expect(buy.observedObi).toBe(freshObi.obiRatio);
    expect(buy.observedStale).toBe(false);
    expect(buy.observedBidUsd).toBeCloseTo(960 / 385, 6);
    expect(buy.observedAskUsd).toBeCloseTo(985 / 385, 6);
    expect(sell.observedObi).toBe(staleObi.obiRatio);
    expect(sell.observedStale).toBe(true);
    expect(sell.observedBidUsd).toBeCloseTo(987 / 385, 6);
    expect(sell.observedAskUsd).toBeCloseTo(959 / 385, 6);

    // Re-read from the file: what was persisted, not what the adapter returned.
    const reloaded = await journal.getDecision(buy.id);
    expect(reloaded?.observedObi).toBe(freshObi.obiRatio);
    expect(reloaded?.observedStale).toBe(false);

    // --- outcomes: one filled, one failed, both on the same decision ------
    await journal.appendOutcome({
      decisionId: buy.id,
      source: 'CSV_IMPORT',
      success: true,
      filledAmountUsdt: 100,
      filledPrice: 385.2,
      realizedSpreadPct: 2,
      realizedProfitUsdt: 1.8,
    });
    await journal.appendOutcome({
      decisionId: buy.id,
      source: 'CSV_IMPORT',
      success: true,
      filledAmountUsdt: 300,
      filledPrice: 385.1,
      realizedSpreadPct: 3,
      realizedProfitUsdt: 6,
    });
    // A failed attempt with no figures: exactly what the ad publisher records. It must
    // count as an attempt and must NOT drag the realized numbers towards zero.
    await journal.appendOutcome({
      decisionId: buy.id,
      source: 'BINANCE_MERCHANT',
      success: false,
      filledAmountUsdt: 0,
      detail: 'El merchant rechazó el anuncio',
    });

    expect(await journal.listOutcomesByDecision(buy.id)).toHaveLength(3);
    expect(await journal.listOutcomesByDecision(sell.id)).toHaveLength(0);

    // --- read model --------------------------------------------------------
    const rows = await journal.getDecisionPerformance();
    expect(rows).toHaveLength(2);
    const buyRow = rows.find((row) => row.decisionId === buy.id)!;
    const sellRow = rows.find((row) => row.decisionId === sell.id)!;

    expect(buyRow.fillCount).toBe(3);
    expect(buyRow.realizedSpreadPct).toBeCloseTo(2.75, 6);
    expect(buyRow.realizedProfitUsdt).toBeCloseTo(7.8, 6);
    expect(buyRow.filledAmountUsdt).toBeCloseTo(400, 6);
    expect(sellRow.fillCount).toBe(0);
    expect(sellRow.realizedSpreadPct).toBeNull();
    expect(sellRow.realizedProfitUsdt).toBeNull();

    // --- verification summary ----------------------------------------------
    const summary = await journal.getVerificationSummary();
    expect(summary).toEqual({
      totalDecisions: 2,
      verifiedDecisions: 1,
      verificationRate: 0.5,
      staleDecisions: 1,
      staleRate: 0.5,
      openCycles: 1,
      decisionsAwaitingOutcome: 1,
    });

    // --- the three promised self-audit queries, on real rows ---------------
    const audit = buildDecisionSelfAudit(rows, summary);
    expect(audit.sides).toEqual([
      {
        side: 'BUY',
        decisions: 1,
        medianModeledSpreadPct: 1.2,
        // The median is over DECISIONS, and this decision's realized spread is already
        // the notional-weighted aggregate of its two filled outcomes.
        medianRealizedSpreadPct: 2.75,
        decisionsWithReportedSpread: 1,
      },
      {
        side: 'SELL',
        decisions: 1,
        medianModeledSpreadPct: 1.4,
        medianRealizedSpreadPct: null,
        decisionsWithReportedSpread: 0,
      },
    ]);
    expect(audit.verification).toEqual({
      totalDecisions: 2,
      decisionsWithRecordedAttempt: 1,
      recordedAttemptRate: 0.5,
      decisionsAwaitingOutcome: 1,
      openCycles: 1,
    });
    expect(audit.staleExposure).toEqual({
      totalDecisions: 2,
      decisionsOnStaleMarket: 1,
      staleRate: 0.5,
    });

    // --- close with the figures the cycle's own outcomes justify ----------
    const outcomes = await journal.listOutcomesByDecision(buy.id);
    const figures = realizedCycleFigures(outcomes);
    expect(figures).toEqual({ realizedProfitUsdt: 7.8, realizedSpreadPct: 2.75 });

    const closed = await journal.closeCycle(cycle.id, {
      status: 'CLOSED',
      closeReason: 'Verificado con el importador de fills.',
      realizedProfitUsdt: figures!.realizedProfitUsdt,
      realizedSpreadPct: figures!.realizedSpreadPct,
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedProfitUsdt).toBeCloseTo(7.8, 6);

    // Closing a cycle does not touch its history: the evidence is still readable and
    // still says what it said before the close, counted straight from SQLite.
    const afterClose = await journal.getDecision(buy.id);
    expect(afterClose?.cycleId).toBe(cycle.id);
    expect(afterClose?.observedObi).toBe(freshObi.obiRatio);
    // The metrics live in the read model, and the close did not rewrite it either.
    const afterCloseRows = await journal.getDecisionPerformance();
    const metricsAfterClose = afterCloseRows.find((row) => row.decisionId === buy.id);
    expect(metricsAfterClose?.realizedSpreadPct).toBeCloseTo(2.75, 6);
    expect(metricsAfterClose?.realizedProfitUsdt).toBeCloseTo(7.8, 6);
    expect(countRows(productionConnection(), 'repricer_decisions')).toBe(2);
    expect(countRows(productionConnection(), 'decision_outcomes')).toBe(3);
  });

  it('refuses an outcome for a decision that does not exist and writes nothing', async () => {
    const cycle = await journal.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 100 });

    await expect(
      journal.appendOutcome({
        decisionId: 9999,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
      }),
    ).rejects.toThrow();

    expect(countRows(productionConnection(), 'decision_outcomes')).toBe(0);
    expect((await journal.getVerificationSummary()).totalDecisions).toBe(0);
    expect((await journal.getCycle(cycle.id))?.status).toBe('OPEN');
  });

  it('refuses a decision for a cycle that does not exist and leaves no row behind', async () => {
    // The classic: a placeholder id used as if it were a real cycle. The adapter rejects
    // it, and — the part that used to be invisible — nothing is left in the table.
    const snapshot = await journal.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 2.49,
      askUsd: 2.56,
      nBids: 2,
      nAsks: 2,
      stale: false,
      fetchedAt: T0,
    });

    await expect(
      journal.appendDecision({
        cycleId: 'PENDING_CYCLE_TRACKING',
        snapshotId: snapshot.id,
        side: 'BUY',
        decisionPrice: 385.5,
        origin: 'AUTO_ENGINE',
        executionMode: 'READ_ONLY',
        action: 'UPDATE',
        modeledSpreadPct: 1.2,
        reason: 'Repriced to hold Top 1',
      }),
    ).rejects.toThrow(/PENDING_CYCLE_TRACKING/);

    expect(countRows(productionConnection(), 'repricer_decisions')).toBe(0);
    expect(await journal.listDecisionsByCycle('PENDING_CYCLE_TRACKING')).toEqual([]);
    expect(await journal.getDecisionPerformance()).toEqual([]);
    // The snapshot is append-only on its own and stays: it is evidence, not garbage.
    expect(countRows(productionConnection(), 'market_snapshots')).toBe(1);
  });

  it('refuses to close a cycle twice and leaves the first close untouched', async () => {
    const cycle = await journal.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 100 });
    await journal.closeCycle(cycle.id, {
      status: 'ABANDONED',
      closeReason: 'Sin ejecución verificable.',
      realizedProfitUsdt: 0,
      realizedSpreadPct: 0,
    });

    await expect(
      journal.closeCycle(cycle.id, {
        status: 'CLOSED',
        closeReason: 'Segundo intento',
        realizedProfitUsdt: 99,
        realizedSpreadPct: 99,
      }),
    ).rejects.toThrow();

    const stored = await journal.getCycle(cycle.id);
    expect(stored?.status).toBe('ABANDONED');
    expect(stored?.closeReason).toBe('Sin ejecución verificable.');
    expect(stored?.realizedProfitUsdt).toBe(0);
  });

  it('hands out copies: a caller cannot rewrite history through a returned record', async () => {
    const cycle = await journal.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 100 });
    const snapshot = await journal.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 2.49,
      askUsd: 2.56,
      nBids: 2,
      nAsks: 2,
      stale: false,
      fetchedAt: T0,
    });
    const decision = await journal.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 385.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'READ_ONLY',
      action: 'UPDATE',
      modeledSpreadPct: 1.2,
      reason: 'Repriced to hold Top 1',
    });

    const first = await journal.getDecision(decision.id);
    (first as { observedObi: number }).observedObi = 999;
    (first as { reason: string }).reason = 'reescrito por el consumidor';

    const second = await journal.getDecision(decision.id);
    expect(second?.observedObi).toBe(0.25);
    expect(second?.reason).toBe('Repriced to hold Top 1');
  });
});

describe('Decision Journal — referential integrity at the SQLite level', () => {
  let db: DatabaseSync;
  let repo: SqliteDecisionJournalRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf8'));
    repo = new SqliteDecisionJournalRepository(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('rejects a dangling cycle reference even when the adapter is bypassed', async () => {
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 2.49,
      askUsd: 2.56,
      nBids: 2,
      nAsks: 2,
      stale: false,
      fetchedAt: T0,
    });

    // Raw SQL, no adapter: the resistance must live in the schema, not in a pre-check.
    expect(() =>
      db
        .prepare(
          `INSERT INTO repricer_decisions
             (cycle_id, snapshot_id, side, decision_price, origin, execution_mode, action,
              modeled_spread_pct, reason, safety_flags_json, observed_obi, observed_bid_usd,
              observed_ask_usd, observed_stale, created_at)
           VALUES (?, ?, 'BUY', 385.5, 'AUTO_ENGINE', 'READ_ONLY', 'UPDATE', 1.2, 'x', '[]',
                   0.25, 2.49, 2.56, 0, ?)`,
        )
        .run('PENDING_CYCLE_TRACKING', snapshot.id, T0),
    ).toThrow(/FOREIGN KEY/i);

    expect(countRows(db, 'repricer_decisions')).toBe(0);
  });

  it('rejects a dangling decision reference even when the adapter is bypassed', async () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO decision_outcomes
             (decision_id, source, success, filled_amount_usdt, recorded_at, created_at)
           VALUES (?, 'CSV_IMPORT', 1, 100, ?, ?)`,
        )
        .run(9999, T0, T0),
    ).toThrow(/FOREIGN KEY/i);

    expect(countRows(db, 'decision_outcomes')).toBe(0);
  });

  it('reports no open-row violations after a clean run', async () => {
    const cycle = await repo.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 500 });
    const snapshot = await repo.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 2.49,
      askUsd: 2.56,
      nBids: 2,
      nAsks: 2,
      stale: false,
      fetchedAt: T0,
    });
    const decision = await repo.appendDecision({
      cycleId: cycle.id,
      snapshotId: snapshot.id,
      side: 'BUY',
      decisionPrice: 385.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'READ_ONLY',
      action: 'UPDATE',
      modeledSpreadPct: 1.2,
      reason: 'Repriced to hold Top 1',
    });
    await repo.appendOutcome({
      decisionId: decision.id,
      source: 'CSV_IMPORT',
      success: true,
      filledAmountUsdt: 100,
      realizedSpreadPct: 2,
      realizedProfitUsdt: 1.8,
    });

    // SQLite's own verdict on the whole file, not the adapter's opinion of it.
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    expect(violations).toEqual([]);
    expect(countRows(db, 'repricer_decisions')).toBe(1);
    expect(countRows(db, 'decision_outcomes')).toBe(1);
  });
});
