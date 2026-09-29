import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionJournalService, IN_MEMORY_JOURNAL_REASON } from './decision-journal.service';
import {
  InMemoryDecisionJournalRepository,
  type CloseDecisionCycleInput,
  type DecisionCyclesFilter,
  type DecisionPerformanceFilter,
  type OpenDecisionCycleInput,
  type RecordDecisionInput,
  type RecordMarketSnapshotInput,
  type RecordOutcomeInput,
} from '@p2p/core';

/**
 * These specs drive the REAL renderer seam (`DecisionJournalService`) on top of the
 * REFERENCE adapter (`InMemoryDecisionJournalRepository`).
 *
 * There is no double of the port on purpose. A double that accepts any `cycleId`
 * proves nothing, and that is exactly how a `PENDING_CYCLE_TRACKING` id once reached
 * the journal with a green suite. The SQLite end-to-end lives in
 * `electron/main/db/decision-journal.integration.spec.ts`; this file covers the
 * orchestration the renderer owns.
 */

type JournalOpName =
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

interface JournalHarness {
  readonly journal: DecisionJournalService;
  readonly repo: InMemoryDecisionJournalRepository;
  readonly ops: () => JournalOpName[];
}

/** Mounts the bridge the preload exposes at `globalThis.p2p.decisionJournal`. */
function installJournalBridge(invoke: (op: JournalOpName, payload?: unknown) => Promise<unknown>) {
  const host = globalThis as { p2p?: Record<string, unknown> };
  host.p2p = { ...(host.p2p ?? {}), decisionJournal: { invoke } };
}

/**
 * The switch mirrors `electron/main/ipc/handlers.ts`, including the wrapped
 * `closeCycle` payload. If the wire shapes diverged, this would exercise a transport
 * that does not exist.
 */
function createJournalHarness(): JournalHarness {
  const repo = new InMemoryDecisionJournalRepository();
  const ops: JournalOpName[] = [];

  installJournalBridge(async (op, payload) => {
    ops.push(op);
    switch (op) {
      case 'appendMarketSnapshot':
        return repo.appendMarketSnapshot(payload as RecordMarketSnapshotInput);
      case 'openCycle':
        return repo.openCycle(payload as OpenDecisionCycleInput);
      case 'closeCycle': {
        const { cycleId, input } = payload as {
          cycleId: string;
          input: CloseDecisionCycleInput;
        };
        return repo.closeCycle(cycleId, input);
      }
      case 'getCycle':
        return repo.getCycle(payload as string);
      case 'listCycles':
        return repo.listCycles(payload as DecisionCyclesFilter | undefined);
      case 'appendDecision':
        return repo.appendDecision(payload as RecordDecisionInput);
      case 'getDecision':
        return repo.getDecision(payload as number);
      case 'listDecisionsByCycle':
        return repo.listDecisionsByCycle(payload as string);
      case 'appendOutcome':
        return repo.appendOutcome(payload as RecordOutcomeInput);
      case 'listOutcomesByDecision':
        return repo.listOutcomesByDecision(payload as number);
      case 'getDecisionPerformance':
        return repo.getDecisionPerformance(payload as DecisionPerformanceFilter | undefined);
      case 'getVerificationSummary':
        return repo.getVerificationSummary(payload as DecisionPerformanceFilter | undefined);
      case 'purgeMarketSnapshotsBefore':
        throw new Error(`decision_journal: unsupported IPC op "${op}"`);
      default:
        throw new Error(`decision_journal: unsupported IPC op "${op}"`);
    }
  });

  // The bridge must exist BEFORE the service is built: it is resolved in a field
  // initializer and throws when missing.
  return { journal: new DecisionJournalService(), repo, ops: () => ops };
}

const NOW = new Date('2026-02-03T12:00:00.000Z').getTime();

describe('DecisionJournalService — cycle close and self-audit', () => {
  let harness: JournalHarness;
  let journal: DecisionJournalService;

  beforeEach(() => {
    harness = createJournalHarness();
    journal = harness.journal;
  });

  /** Cycle + snapshot + one decision, the minimum a close can be attempted on. */
  async function seedCycleWithDecision(): Promise<{ cycleId: string; decisionId: number }> {
    const cycle = await harness.repo.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
    const snapshot = await harness.repo.appendMarketSnapshot({
      obi: 0.25,
      bidUsd: 0.0092,
      askUsd: 0.0094,
      nBids: 8,
      nAsks: 6,
      stale: false,
      fetchedAt: NOW,
    });
    const decision = await harness.repo.appendDecision({
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
    return { cycleId: cycle.id, decisionId: decision.id };
  }

  describe('closeCycleWithRealizedFigures', () => {
    it('closes as CLOSED with the figures computed from the cycle outcomes', async () => {
      const { cycleId, decisionId } = await seedCycleWithDecision();
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
        realizedSpreadPct: 2,
        realizedProfitUsdt: 1.8,
      });
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 300,
        realizedSpreadPct: 3,
        realizedProfitUsdt: 6,
      });

      const cycle = await journal.closeCycleWithRealizedFigures(
        cycleId,
        'Operación verificada por el importador de fills.',
      );

      expect(cycle.status).toBe('CLOSED');
      expect(cycle.realizedProfitUsdt).toBe(7.8);
      expect(cycle.realizedSpreadPct).toBe(2.75);
      expect(cycle.closeReason).toBe('Operación verificada por el importador de fills.');
    });

    it('adds up the outcomes of every decision in the cycle', async () => {
      const { cycleId, decisionId } = await seedCycleWithDecision();
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
        realizedSpreadPct: 2,
        realizedProfitUsdt: 1.8,
      });
      // A second decision in the same cycle, repriced on a newer snapshot.
      const snapshot = await harness.repo.appendMarketSnapshot({
        obi: 0.3,
        bidUsd: 0.0091,
        askUsd: 0.0094,
        nBids: 8,
        nAsks: 6,
        stale: false,
        fetchedAt: NOW,
      });
      const second = await harness.repo.appendDecision({
        cycleId,
        snapshotId: snapshot.id,
        side: 'SELL',
        decisionPrice: 385.2,
        origin: 'AUTO_ENGINE',
        executionMode: 'READ_ONLY',
        action: 'UPDATE',
        modeledSpreadPct: 1.4,
        reason: 'Repriced to hold Top 1',
      });
      await harness.repo.appendOutcome({
        decisionId: second.id,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 300,
        realizedSpreadPct: 3,
        realizedProfitUsdt: 6,
      });

      const cycle = await journal.closeCycleWithRealizedFigures(cycleId, 'ciclo verificado');

      expect(cycle.realizedProfitUsdt).toBe(7.8);
      expect(cycle.realizedSpreadPct).toBe(2.75);
    });

    it('refuses a cycle with no outcomes instead of closing it with invented zeros', async () => {
      const { cycleId } = await seedCycleWithDecision();

      await expect(journal.closeCycleWithRealizedFigures(cycleId, 'cierre manual')).rejects.toThrow(
        /ABANDONED/,
      );

      expect((await harness.repo.getCycle(cycleId))?.status).toBe('OPEN');
    });

    it('refuses when the outcomes record attempts but no realized spread', async () => {
      const { cycleId, decisionId } = await seedCycleWithDecision();
      // Exactly what the production publisher records today.
      await harness.repo.appendOutcome({
        decisionId,
        source: 'BINANCE_MERCHANT',
        success: true,
        filledAmountUsdt: 0,
      });

      await expect(journal.closeCycleWithRealizedFigures(cycleId, 'cierre manual')).rejects.toThrow(
        /ABANDONED/,
      );
      expect((await harness.repo.getCycle(cycleId))?.status).toBe('OPEN');
    });

    it('reports an unknown cycle as such, not as a cycle without outcomes', async () => {
      await expect(
        journal.closeCycleWithRealizedFigures('PENDING_CYCLE_TRACKING', 'cierre manual'),
      ).rejects.toThrow(/PENDING_CYCLE_TRACKING/);
    });

    it('rejects closing a cycle that is already terminal', async () => {
      const { cycleId, decisionId } = await seedCycleWithDecision();
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
        realizedSpreadPct: 2,
        realizedProfitUsdt: 1.8,
      });
      await journal.closeCycleWithRealizedFigures(cycleId, 'primer cierre');

      await expect(journal.closeCycleWithRealizedFigures(cycleId, 'segundo cierre')).rejects.toThrow();
    });
  });

  describe('abandonCycle', () => {
    it('abandons a cycle with no outcomes recording zero figures and the reason', async () => {
      const { cycleId } = await seedCycleWithDecision();

      const cycle = await journal.abandonCycle(cycleId, 'Sin ejecución verificable.');

      expect(cycle.status).toBe('ABANDONED');
      expect(cycle.realizedProfitUsdt).toBe(0);
      expect(cycle.realizedSpreadPct).toBe(0);
      expect(cycle.closeReason).toBe('Sin ejecución verificable.');
    });

    it('keeps the figures the recorded outcomes justify', async () => {
      const { cycleId, decisionId } = await seedCycleWithDecision();
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
        realizedSpreadPct: 2,
        realizedProfitUsdt: 1.8,
      });

      const cycle = await journal.abandonCycle(cycleId, 'Cerrado a mano.');

      expect(cycle.status).toBe('ABANDONED');
      expect(cycle.realizedProfitUsdt).toBe(1.8);
      expect(cycle.realizedSpreadPct).toBe(2);
    });
  });

  describe('getSelfAudit', () => {
    it('answers the three audit questions for the whole journal', async () => {
      const { decisionId } = await seedCycleWithDecision();
      await harness.repo.appendOutcome({
        decisionId,
        source: 'CSV_IMPORT',
        success: true,
        filledAmountUsdt: 100,
        realizedSpreadPct: 2,
        realizedProfitUsdt: 1.8,
      });

      const audit = await journal.getSelfAudit();

      expect(audit.sides.map((side) => side.side)).toEqual(['BUY', 'SELL']);
      expect(audit.sides[0]).toEqual({
        side: 'BUY',
        decisions: 1,
        medianModeledSpreadPct: 1.2,
        medianRealizedSpreadPct: 2,
        decisionsWithReportedSpread: 1,
      });
      expect(audit.sides[1]?.medianModeledSpreadPct).toBeNull();
      expect(audit.verification).toEqual({
        totalDecisions: 1,
        decisionsWithRecordedAttempt: 1,
        recordedAttemptRate: 1,
        decisionsAwaitingOutcome: 0,
        openCycles: 1,
      });
      expect(audit.staleExposure).toEqual({
        totalDecisions: 1,
        decisionsOnStaleMarket: 0,
        staleRate: 0,
      });
    });

    it('reads the performance rows and the summary with the same filter', async () => {
      await seedCycleWithDecision();

      const audit = await journal.getSelfAudit({ side: 'SELL' });

      expect(audit.verification.totalDecisions).toBe(0);
      expect(audit.sides[0]?.decisions).toBe(0);
      expect(harness.ops()).toEqual(expect.arrayContaining(['getDecisionPerformance', 'getVerificationSummary']));
    });
  });
});

/**
 * The bridge is resolved in a field initializer, so these specs build the service by
 * hand with the host it will find. That is not a shortcut: `resolveJournalBridge` reads
 * `globalThis.p2p` / `globalThis.electron` exactly once, and the only way to observe
 * which of the two it picked is to control the host before construction.
 */
describe('DecisionJournalService — journal availability', () => {
  interface JournalHost {
    p2p?: { decisionJournal?: unknown };
    electron?: { decisionJournal?: unknown };
  }

  const host = globalThis as JournalHost;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete host.p2p;
    delete host.electron;
    // The degradation still logs; silencing it keeps the failure output readable and
    // lets the test assert the console path separately.
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete host.p2p;
    delete host.electron;
    warn.mockRestore();
  });

  it('declares itself degraded, with a reason, when no bridge is present', () => {
    const journal = new DecisionJournalService();

    expect(journal.availability.degraded).toBe(true);
    expect(journal.availability.reason).toBe(IN_MEMORY_JOURNAL_REASON);
    // The console line is the echo of that declaration, not the declaration itself.
    expect(warn).toHaveBeenCalled();
  });

  it('degrades without taking the caller down: reads still answer', async () => {
    const journal = new DecisionJournalService();

    // A degraded journal that threw would take the terminal down over an optional data
    // source. A degraded journal that reads as "empty" is a journal that looks like it
    // decided not to write. It has to keep answering, AND say it is answering from RAM.
    const summary = await journal.getVerificationSummary();

    expect(journal.availability.degraded).toBe(true);
    expect(summary.totalDecisions).toBe(0);
  });

  it('does not report degraded when the real Electron bridge is in use', () => {
    installJournalBridge(async () => ({}));

    const journal = new DecisionJournalService();

    expect(journal.availability.degraded).toBe(false);
    // Healthy has nothing to explain: an empty reason is the honest value here.
    expect(journal.availability.reason).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads through the real bridge, not through the in-memory fallback', async () => {
    installJournalBridge(async () => ({
      totalDecisions: 7,
      verifiedDecisions: 3,
      verificationRate: 3 / 7,
      staleDecisions: 0,
      staleRate: 0,
      openCycles: 0,
      decisionsAwaitingOutcome: 4,
    }));

    const journal = new DecisionJournalService();

    // Same numbers the bridge returned: a service that quietly swapped in its own store
    // would report its own empty journal and call it persistence.
    await expect(journal.getVerificationSummary()).resolves.toMatchObject({ totalDecisions: 7 });
    expect(journal.availability.degraded).toBe(false);
  });
});
