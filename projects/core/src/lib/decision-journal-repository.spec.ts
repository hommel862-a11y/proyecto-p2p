import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryDecisionJournalRepository,
  realizedCycleFigures,
} from './decision-journal-repository';
import type {
  DecisionJournalRepository,
  DecisionPerformanceFilter,
} from './decision-journal-repository';
import type {
  DecisionCycleCloseStatus,
  DecisionOutcome,
  MarketSnapshot,
  RecordDecisionInput,
  RecordMarketSnapshotInput,
  RecordOutcomeInput,
} from './decision-journal';

const FIXED_NOW = new Date('2026-02-03T12:00:00.000Z');
const FIXED_EPOCH_MS = FIXED_NOW.getTime();

const marketInput = (
  overrides: Partial<RecordMarketSnapshotInput> = {},
): RecordMarketSnapshotInput => ({
  obi: 0.25,
  bidUsd: 0.0092,
  askUsd: 0.0094,
  nBids: 8,
  nAsks: 6,
  stale: false,
  fetchedAt: FIXED_EPOCH_MS,
  ...overrides,
});

const decisionInput = (
  overrides: Partial<RecordDecisionInput> = {},
): RecordDecisionInput => ({
  cycleId: 'cycle-placeholder',
  snapshotId: 1,
  side: 'BUY',
  decisionPrice: 385.5,
  origin: 'AUTO_ENGINE',
  executionMode: 'READ_ONLY',
  action: 'UPDATE',
  modeledSpreadPct: 1.2,
  reason: 'Repriced to hold Top 1',
  ...overrides,
});

const outcomeInput = (overrides: Partial<RecordOutcomeInput> = {}): RecordOutcomeInput => ({
  decisionId: 1,
  source: 'LOCAL_SIGNAL',
  success: true,
  filledAmountUsdt: 100,
  filledPrice: 384.9,
  realizedSpreadPct: 2,
  realizedProfitUsdt: 1.5,
  ...overrides,
});

describe('DecisionJournalRepository (Hexagonal Architecture Port & Adapter)', () => {
  let repo: InMemoryDecisionJournalRepository;
  let port: DecisionJournalRepository;
  let cycleId: string;
  let snapshotId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    repo = new InMemoryDecisionJournalRepository();
    port = repo;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('append-only writes and id assignment', () => {
    it('assigns monotonically increasing ids per table', async () => {
      const snap1 = await port.appendMarketSnapshot(marketInput());
      const snap2 = await port.appendMarketSnapshot(marketInput());
      expect(snap1.id).toBe(1);
      expect(snap2.id).toBe(2);

      const cycle = await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
      const decision1 = await port.appendDecision(
        decisionInput({ cycleId: cycle.id, snapshotId: snap1.id }),
      );
      const decision2 = await port.appendDecision(
        decisionInput({ cycleId: cycle.id, snapshotId: snap2.id }),
      );
      expect(decision1.id).toBe(1);
      expect(decision2.id).toBe(2);

      const outcome1 = await port.appendOutcome(outcomeInput({ decisionId: decision1.id }));
      const outcome2 = await port.appendOutcome(outcomeInput({ decisionId: decision1.id }));
      expect(outcome1.id).toBe(1);
      expect(outcome2.id).toBe(2);
    });

    it('stamps createdAt with the wall clock', async () => {
      const snap = await port.appendMarketSnapshot(marketInput());
      expect(snap.createdAt).toBe(FIXED_EPOCH_MS);
    });

    it('exposes no mutation or deletion for decisions and outcomes', () => {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repo))
        .filter((name) => name !== 'constructor')
        .sort();
      expect(methods).toEqual(
        [
          'appendDecision',
          'appendMarketSnapshot',
          'appendOutcome',
          'closeCycle',
          'getCycle',
          'getDecision',
          'getDecisionPerformance',
          'getVerificationSummary',
          'listCycles',
          'listDecisionsByCycle',
          'listOutcomesByDecision',
          'openCycle',
        ].sort(),
      );
    });

    it('keeps safety flags immutable and detached from the caller array', async () => {
      const cycle = await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
      const snapshot = await port.appendMarketSnapshot(marketInput());
      const flags = ['STALE_MARKET'];
      const decision = await port.appendDecision(
        decisionInput({ cycleId: cycle.id, snapshotId: snapshot.id, safetyFlags: flags }),
      );
      flags.push('MUTATED_BY_CALLER');

      const stored = await port.getDecision(decision.id);
      expect(stored?.safetyFlags).toEqual(['STALE_MARKET']);
    });
  });

  describe('referential integrity', () => {
    beforeEach(async () => {
      cycleId = (await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 })).id;
      snapshotId = (await port.appendMarketSnapshot(marketInput())).id;
    });

    it('rejects a decision that references an unknown cycle', async () => {
      await expect(
        port.appendDecision(decisionInput({ cycleId: 'cycle-does-not-exist', snapshotId })),
      ).rejects.toThrow(/cycle/i);
    });

    it('rejects a decision that references an unknown snapshot', async () => {
      await expect(
        port.appendDecision(decisionInput({ cycleId, snapshotId: 999 })),
      ).rejects.toThrow(/snapshot/i);
    });

    it('rejects an outcome that references an unknown decision', async () => {
      await expect(port.appendOutcome(outcomeInput({ decisionId: 999 }))).rejects.toThrow(
        /decision/i,
      );
    });

    it('copies the observed market context from the referenced snapshot', async () => {
      const staleSnapshot = await port.appendMarketSnapshot(
        marketInput({ obi: -0.5, bidUsd: 0.009, askUsd: 0.0095, stale: true }),
      );
      const decision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId: staleSnapshot.id, origin: 'AUTO_ENGINE' }),
      );

      // The caller never supplies observed_*: the journal cannot disagree with
      // the snapshot it points at.
      expect(decision.observedObi).toBe(-0.5);
      expect(decision.observedBidUsd).toBe(0.009);
      expect(decision.observedAskUsd).toBe(0.0095);
      expect(decision.observedStale).toBe(true);
    });
  });

  describe('decision cycles', () => {
    beforeEach(async () => {
      cycleId = (await port.openCycle({
        origin: 'OPERATOR',
        capitalReservedUsdt: 500,
        title: 'Sesion 2026-02-03',
      })).id;
      snapshotId = (await port.appendMarketSnapshot(marketInput())).id;
    });

    it('opens a cycle as OPEN with no realized figures', async () => {
      const cycle = await port.getCycle(cycleId);
      expect(cycle?.status).toBe('OPEN');
      expect(cycle?.closedAt).toBeNull();
      expect(cycle?.closeReason).toBeNull();
      expect(cycle?.realizedProfitUsdt).toBeNull();
      expect(cycle?.realizedSpreadPct).toBeNull();
      expect(cycle?.capitalReservedUsdt).toBe(500);
      expect(cycle?.createdAt).toBe(FIXED_EPOCH_MS);
    });

    it('moves an open cycle to CLOSED keeping its creation stamp', async () => {
      await port.appendDecision(decisionInput({ cycleId, snapshotId }));

      const closed = await port.closeCycle(cycleId, {
        status: 'CLOSED',
        closeReason: 'Sesion cerrada por el operador',
        realizedProfitUsdt: 3.25,
        realizedSpreadPct: 1.4,
      });

      expect(closed.status).toBe('CLOSED');
      expect(closed.realizedProfitUsdt).toBe(3.25);
      expect(closed.realizedSpreadPct).toBe(1.4);
      expect(closed.closeReason).toBe('Sesion cerrada por el operador');
      expect(closed.closedAt).toBe(FIXED_EPOCH_MS);
      expect(closed.createdAt).toBe(FIXED_EPOCH_MS);
      expect(closed.updatedAt).toBe(FIXED_EPOCH_MS);
    });

    it('can abandon a cycle instead of closing it', async () => {
      const abandoned = await port.closeCycle(cycleId, {
        status: 'ABANDONED',
        closeReason: 'Mercado iliquido',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });
      expect(abandoned.status).toBe('ABANDONED');
    });

    it('rejects closing a cycle that is already CLOSED', async () => {
      await port.closeCycle(cycleId, {
        status: 'CLOSED',
        closeReason: 'primero',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });
      await expect(
        port.closeCycle(cycleId, {
          status: 'CLOSED',
          closeReason: 'segundo',
          realizedProfitUsdt: 0,
          realizedSpreadPct: 0,
        }),
      ).rejects.toThrow(/closed/i);
    });

    it('rejects closing a cycle that is already ABANDONED', async () => {
      await port.closeCycle(cycleId, {
        status: 'ABANDONED',
        closeReason: 'primero',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });
      await expect(
        port.closeCycle(cycleId, {
          status: 'CLOSED',
          closeReason: 'segundo',
          realizedProfitUsdt: 0,
          realizedSpreadPct: 0,
        }),
      ).rejects.toThrow(/abandoned/i);
    });

    it('rejects closing an unknown cycle', async () => {
      await expect(
        port.closeCycle('cycle-nope', {
          status: 'CLOSED',
          closeReason: 'x',
          realizedProfitUsdt: 0,
          realizedSpreadPct: 0,
        }),
      ).rejects.toThrow(/cycle/i);
    });

    // -------------------------------------------------------------------------
    // The terminal-cycle invariant.
    //
    // `DecisionCycleCloseStatus` is `'CLOSED' | 'ABANDONED'`, so every call below has to
    // cast to reach a status the types forbid. That is not test noise: the real caller of
    // the raw port is the IPC boundary, where the payload is `unknown` and reaches
    // `closeCycle` unvalidated. If the adapter trusts the type, a caller that asks for
    // `status: 'OPEN'` gets a row stamped `closed_at` whose realized figures are set
    // while the cycle still counts as open — and a second call then overwrites those
    // figures. These tests pin the runtime refusal that the type alone does not give.
    // -------------------------------------------------------------------------

    it('rejects a close asking for a non-terminal status instead of half-closing the cycle', async () => {
      for (const asked of ['OPEN', 'CLOSED_PENDING', '', 'closed']) {
        await expect(
          port.closeCycle(cycleId, {
            status: asked as DecisionCycleCloseStatus,
            closeReason: 'no es un cierre',
            realizedProfitUsdt: 5,
            realizedSpreadPct: 5,
          }),
        ).rejects.toThrow(/decision_journal:.*terminal/i);
      }

      // Rejected before any write: the cycle is untouched, so the refusal cannot be
      // mistaken for a close that happened and then failed.
      const untouched = await port.getCycle(cycleId);
      expect(untouched?.status).toBe('OPEN');
      expect(untouched?.closedAt).toBeNull();
      expect(untouched?.closeReason).toBeNull();
      expect(untouched?.realizedProfitUsdt).toBeNull();
      expect(untouched?.realizedSpreadPct).toBeNull();
    });

    it('rejects the non-terminal status even when the cycle does not exist', async () => {
      // Request validity is checked before state, so a caller with a malformed close
      // learns that, and not that it typo'd a cycle id.
      await expect(
        port.closeCycle('cycle-nope', {
          status: 'OPEN' as DecisionCycleCloseStatus,
          closeReason: 'x',
          realizedProfitUsdt: 0,
          realizedSpreadPct: 0,
        }),
      ).rejects.toThrow(/terminal/i);
    });

    it('refuses a second close and leaves the first close figures untouched', async () => {
      const closed = await port.closeCycle(cycleId, {
        status: 'CLOSED',
        closeReason: 'primer cierre',
        realizedProfitUsdt: 7.8,
        realizedSpreadPct: 2.75,
      });

      for (const attempt of [
        { status: 'CLOSED' as DecisionCycleCloseStatus, realizedProfitUsdt: 99, realizedSpreadPct: 99 },
        { status: 'ABANDONED' as DecisionCycleCloseStatus, realizedProfitUsdt: 99, realizedSpreadPct: 99 },
      ]) {
        await expect(
          port.closeCycle(cycleId, {
            status: attempt.status,
            closeReason: 'segundo intento',
            realizedProfitUsdt: attempt.realizedProfitUsdt,
            realizedSpreadPct: attempt.realizedSpreadPct,
          }),
        ).rejects.toThrow(/already CLOSED and cannot be closed again/);

        // The realized figures are what the operator reads to judge performance.
        // A refused re-close must not be able to restate them.
        const stored = await port.getCycle(cycleId);
        expect(stored).toEqual(closed);
        expect(stored?.realizedProfitUsdt).toBe(7.8);
        expect(stored?.realizedSpreadPct).toBe(2.75);
      }
    });

    it('refuses a decision appended to a CLOSED cycle', async () => {
      await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      await port.closeCycle(cycleId, {
        status: 'CLOSED',
        closeReason: 'fin de sesion',
        realizedProfitUsdt: 3.25,
        realizedSpreadPct: 1.4,
      });

      // A cycle closed with figures frozen from the decisions it held must not keep
      // growing behind the operator's back: a decision added now is excluded from
      // `realizedProfitUsdt`, so the cycle total silently stops describing its rows.
      await expect(
        port.appendDecision(decisionInput({ cycleId, snapshotId, reason: ' posterior al cierre' })),
      ).rejects.toThrow(/decision_journal:.*is CLOSED and cannot accept new decisions/);

      expect(await port.listDecisionsByCycle(cycleId)).toHaveLength(1);
      const summary = await port.getVerificationSummary();
      expect(summary.openCycles).toBe(0);
      expect(summary.totalDecisions).toBe(1);
    });

    it('refuses a decision appended to an ABANDONED cycle', async () => {
      await port.closeCycle(cycleId, {
        status: 'ABANDONED',
        closeReason: 'Mercado iliquido',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });

      await expect(
        port.appendDecision(decisionInput({ cycleId, snapshotId })),
      ).rejects.toThrow(/decision_journal:.*is ABANDONED and cannot accept new decisions/);

      expect(await port.listDecisionsByCycle(cycleId)).toEqual([]);
    });

    it('still refuses an unknown cycle before looking at its status', async () => {
      // Order matters for the operator: "which cycle?" is answerable without the
      // journal, so it is asked first and never reported as a lifecycle problem.
      await expect(
        port.appendDecision(decisionInput({ cycleId: 'cycle-nope', snapshotId })),
      ).rejects.toThrow(/unknown cycle/);
    });

    it('lists cycles filtered by status', async () => {
      const other = await port.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 100 });
      await port.closeCycle(other.id, {
        status: 'ABANDONED',
        closeReason: 'x',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });

      const open = await port.listCycles({ status: 'OPEN' });
      expect(open.map((c) => c.id)).toEqual([cycleId]);
      expect((await port.listCycles({ status: 'ABANDONED' })).map((c) => c.id)).toEqual([
        other.id,
      ]);
      expect(await port.listCycles({ origin: 'AUTO_ENGINE' })).toHaveLength(1);
      expect(await port.listCycles()).toHaveLength(2);
    });

    it('lists the decisions of a cycle in insertion order', async () => {
      const d1 = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      const d2 = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      const otherCycle = await port.openCycle({
        origin: 'OPERATOR',
        capitalReservedUsdt: 1,
      });
      const foreign = await port.appendDecision(
        decisionInput({ cycleId: otherCycle.id, snapshotId }),
      );

      const mine = await port.listDecisionsByCycle(cycleId);
      expect(mine.map((d) => d.id)).toEqual([d1.id, d2.id]);
      expect(mine.map((d) => d.id)).not.toContain(foreign.id);
    });
  });

  describe('outcomes', () => {
    beforeEach(async () => {
      cycleId = (await port.openCycle({ origin: 'MCP_AGENT', capitalReservedUsdt: 250 })).id;
      snapshotId = (await port.appendMarketSnapshot(marketInput())).id;
    });

    it('keeps every fill of a decision, including the failed ones', async () => {
      const decision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId, executionMode: 'PUBLISHING' }),
      );

      const published = await port.appendOutcome(
        outcomeInput({ decisionId: decision.id, source: 'BINANCE_MERCHANT' }),
      );
      const failed = await port.appendOutcome(
        outcomeInput({
          decisionId: decision.id,
          success: false,
          filledAmountUsdt: 0,
          filledPrice: undefined,
          realizedSpreadPct: undefined,
          realizedProfitUsdt: undefined,
          detail: 'Binance merchant API returned 500',
        }),
      );

      const outcomes = await port.listOutcomesByDecision(decision.id);
      expect(outcomes.map((o) => o.id)).toEqual([published.id, failed.id]);
      expect(outcomes[1].success).toBe(false);
      expect(outcomes[1].detail).toBe('Binance merchant API returned 500');
      expect(outcomes[1].recordedAt).toBe(FIXED_EPOCH_MS);
    });

    it('returns null and empty lists for unknown references', async () => {
      expect(await port.getCycle('cycle-nope')).toBeNull();
      expect(await port.getDecision(999)).toBeNull();
      expect(await port.listDecisionsByCycle('cycle-nope')).toEqual([]);
      expect(await port.listOutcomesByDecision(999)).toEqual([]);
    });
  });

  describe('getDecisionPerformance (LEFT JOIN read model)', () => {
    beforeEach(async () => {
      cycleId = (await port.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 500 })).id;
      snapshotId = (await port.appendMarketSnapshot(marketInput())).id;
    });

    it('keeps a decision with no outcome, with a zero fill count and nulls', async () => {
      const decision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId, executionMode: 'PUBLISHING' }),
      );

      const rows = await port.getDecisionPerformance();
      expect(rows).toEqual([
        {
          decisionId: decision.id,
          cycleId,
          side: 'BUY',
          origin: 'AUTO_ENGINE',
          executionMode: 'PUBLISHING',
          decisionPrice: 385.5,
          modeledSpreadPct: 1.2,
          observedStale: false,
          observedObi: 0.25,
          fillCount: 0,
          realizedSpreadPct: null,
          realizedProfitUsdt: null,
          filledAmountUsdt: null,
          decidedAt: FIXED_EPOCH_MS,
        },
      ]);
    });

    it('aggregates partial fills into a single row weighted by filled amount', async () => {
      const decision = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      await port.appendOutcome(outcomeInput({ decisionId: decision.id, filledAmountUsdt: 100, realizedSpreadPct: 2, realizedProfitUsdt: 1 }));
      await port.appendOutcome(outcomeInput({ decisionId: decision.id, filledAmountUsdt: 300, realizedSpreadPct: 1, realizedProfitUsdt: 2 }));

      const [row] = await port.getDecisionPerformance();
      expect(row.fillCount).toBe(2);
      expect(row.filledAmountUsdt).toBe(400);
      expect(row.realizedProfitUsdt).toBe(3);
      expect(row.realizedSpreadPct).toBe(1.25);
    });

    it('falls back to the plain mean when every reporting outcome filled 0', async () => {
      const decision = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      // A historical import: the spreads are known, the notionals were not recorded.
      await port.appendOutcome(
        outcomeInput({
          decisionId: decision.id,
          filledAmountUsdt: 0,
          filledPrice: undefined,
          realizedSpreadPct: 1,
          realizedProfitUsdt: 0,
        }),
      );
      await port.appendOutcome(
        outcomeInput({
          decisionId: decision.id,
          filledAmountUsdt: 0,
          filledPrice: undefined,
          realizedSpreadPct: 2,
          realizedProfitUsdt: 0,
        }),
      );

      const [row] = await port.getDecisionPerformance();
      // The notional total is 0, so the weighting carries no information and the
      // documented contract is the plain mean: (1 + 2) / 2 = 1.5. Reporting 0 here
      // would be a value a consumer cannot tell apart from "we captured nothing".
      expect(row.fillCount).toBe(2);
      expect(row.filledAmountUsdt).toBe(0);
      expect(row.realizedSpreadPct).toBe(1.5);
    });

    it('keeps the notional weighting when only some reporting outcomes filled 0', async () => {
      const decision = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      await port.appendOutcome(
        outcomeInput({
          decisionId: decision.id,
          filledAmountUsdt: 0,
          filledPrice: undefined,
          realizedSpreadPct: 1,
          realizedProfitUsdt: 0,
        }),
      );
      await port.appendOutcome(
        outcomeInput({ decisionId: decision.id, filledAmountUsdt: 100, realizedSpreadPct: 2 }),
      );

      const [row] = await port.getDecisionPerformance();
      // The fallback is only for the all-zero case: (1*0 + 2*100) / 100 = 2, not 1.5.
      expect(row.realizedSpreadPct).toBe(2);
    });

    it('reports a null realized spread when no outcome reports one', async () => {
      const decision = await port.appendDecision(decisionInput({ cycleId, snapshotId }));
      await port.appendOutcome(
        outcomeInput({
          decisionId: decision.id,
          realizedSpreadPct: undefined,
          realizedProfitUsdt: undefined,
        }),
      );

      const [row] = await port.getDecisionPerformance();
      expect(row.fillCount).toBe(1);
      expect(row.realizedSpreadPct).toBeNull();
      expect(row.realizedProfitUsdt).toBeNull();
    });

    it('filters by side, origin, execution mode, staleness and verification', async () => {
      const staleSnapshot = await port.appendMarketSnapshot(marketInput({ stale: true }));
      const freshDecision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId, side: 'SELL', origin: 'OPERATOR' }),
      );
      const staleDecision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId: staleSnapshot.id, origin: 'MCP_AGENT' }),
      );
      await port.appendOutcome(outcomeInput({ decisionId: freshDecision.id }));

      const bySide = await port.getDecisionPerformance({ side: 'SELL' });
      expect(bySide.map((r) => r.decisionId)).toEqual([freshDecision.id]);

      const byOrigin = await port.getDecisionPerformance({ origin: 'MCP_AGENT' });
      expect(byOrigin.map((r) => r.decisionId)).toEqual([staleDecision.id]);

      const staleOnly = await port.getDecisionPerformance({ staleOnly: true });
      expect(staleOnly.map((r) => r.decisionId)).toEqual([staleDecision.id]);

      const verifiedOnly = await port.getDecisionPerformance({ verifiedOnly: true });
      expect(verifiedOnly.map((r) => r.decisionId)).toEqual([freshDecision.id]);

      const readOnlyOnly = await port.getDecisionPerformance({ executionMode: 'PUBLISHING' });
      expect(readOnlyOnly).toEqual([]);

      const byCycle: DecisionPerformanceFilter = { cycleId: 'cycle-nope' };
      expect(await port.getDecisionPerformance(byCycle)).toEqual([]);
    });
  });

  describe('getVerificationSummary', () => {
    it('returns zeroed rates for an empty journal', async () => {
      const summary = await port.getVerificationSummary();
      expect(summary).toEqual({
        totalDecisions: 0,
        verifiedDecisions: 0,
        verificationRate: 0,
        journaledDecisions: 0,
        staleDecisions: 0,
        staleRate: 0,
        openCycles: 0,
        decisionsAwaitingOutcome: 0,
      });
    });

    it('computes verificationRate, staleRate and the awaiting backlog', async () => {
      const cycleA = await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
      const cycleB = await port.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 100 });
      const fresh = await port.appendMarketSnapshot(marketInput());
      const stale = await port.appendMarketSnapshot(marketInput({ stale: true }));

      const d1 = await port.appendDecision(
        decisionInput({ cycleId: cycleA.id, snapshotId: fresh.id }),
      );
      await port.appendDecision(decisionInput({ cycleId: cycleA.id, snapshotId: fresh.id }));
      await port.appendDecision(
        decisionInput({ cycleId: cycleA.id, snapshotId: stale.id }),
      );
      await port.appendOutcome(outcomeInput({ decisionId: d1.id }));

      const summary = await port.getVerificationSummary();
      expect(summary.totalDecisions).toBe(3);
      expect(summary.journaledDecisions).toBe(3);
      expect(summary.verifiedDecisions).toBe(1);
      expect(summary.verificationRate).toBeCloseTo(1 / 3, 4);
      expect(summary.staleDecisions).toBe(1);
      expect(summary.staleRate).toBeCloseTo(1 / 3, 4);
      expect(summary.openCycles).toBe(2);
      expect(summary.decisionsAwaitingOutcome).toBe(2);

      await port.closeCycle(cycleB.id, {
        status: 'ABANDONED',
        closeReason: 'x',
        realizedProfitUsdt: 0,
        realizedSpreadPct: 0,
      });
      expect((await port.getVerificationSummary()).openCycles).toBe(1);
    });

    it('scopes the summary to the given filter', async () => {
      const cycleA = await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
      const cycleB = await port.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 100 });
      const fresh = await port.appendMarketSnapshot(marketInput());
      const d1 = await port.appendDecision(
        decisionInput({ cycleId: cycleA.id, snapshotId: fresh.id, origin: 'OPERATOR' }),
      );
      const d2 = await port.appendDecision(
        decisionInput({ cycleId: cycleB.id, snapshotId: fresh.id, origin: 'AUTO_ENGINE' }),
      );
      await port.appendOutcome(outcomeInput({ decisionId: d2.id }));

      const summary = await port.getVerificationSummary({ origin: 'OPERATOR' });
      expect(summary.totalDecisions).toBe(1);
      expect(summary.verifiedDecisions).toBe(0);
      expect(summary.verificationRate).toBe(0);
      expect(summary.decisionsAwaitingOutcome).toBe(1);
      expect(summary.openCycles).toBe(1);
    });

    // Two rates, two questions, two populations. Every test below FAILS against a
    // summary that applies ONE action filter to the whole slice — which is the trap: the
    // naive "exclude KEEP/PAUSE by action" fix makes the verification rate honest only by
    // making `staleDecisions` stop counting the KEEPs and PAUSEs, and staleness is the
    // signal the engine most needs to keep.
    describe('a decision that can never be verified', () => {
      /** Cycle + one fresh and one stale snapshot, ready to receive a mix of actions. */
      async function scaffoldMixed() {
        const cycleId = (await port.openCycle({ origin: 'AUTO_ENGINE', capitalReservedUsdt: 0 })).id;
        const fresh = await port.appendMarketSnapshot(marketInput());
        const stale = await port.appendMarketSnapshot(marketInput({ stale: true }));
        return { cycleId, fresh, stale };
      }

      it('does not damage the verification rate of the decisions that can be verified', async () => {
        const { cycleId, fresh } = await scaffoldMixed();

        const updatable = await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'UPDATE' }),
        );
        await port.appendOutcome(outcomeInput({ decisionId: updatable.id }));
        const before = await port.getVerificationSummary();

        // Two real decisions, neither of which can ever carry an outcome.
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'KEEP' }),
        );
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'PAUSE' }),
        );
        const after = await port.getVerificationSummary();

        // 1/1 before, 1/1 after: the rate cannot decay for a reason that is not a failure.
        expect(before.verificationRate).toBe(1);
        expect(after.verificationRate).toBe(1);
        expect(after.verifiedDecisions).toBe(1);
        // ...and they are counted as journaled, which is the whole point of storing them.
        expect(after.journaledDecisions).toBe(3);
        expect(after.totalDecisions).toBe(1);
        // Nor do they invent a backlog nobody can ever clear.
        expect(after.decisionsAwaitingOutcome).toBe(0);
      });

      it('still shows up in the staleness figure, which is asked of every decision', async () => {
        const { cycleId, fresh, stale } = await scaffoldMixed();

        // `evaluateRepricer` can return a PAUSE or a KEEP on cached data exactly as it can
        // return an UPDATE, so staleness has to be asked of all three.
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'UPDATE' }),
        );
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: stale.id, action: 'PAUSE' }),
        );
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: stale.id, action: 'KEEP' }),
        );

        const summary = await port.getVerificationSummary();

        // THE TRAP: one action filter would report 0 here, because both stale decisions are
        // non-publishable. The engine would read "always fresh" on a run where two of its
        // three decisions were taken on a book it already knew was old.
        expect(summary.staleDecisions).toBe(2);
        expect(summary.staleRate).toBeCloseTo(2 / 3, 4);
        // Two different denominators, on purpose and by name.
        expect(summary.totalDecisions).toBe(1);
        expect(summary.journaledDecisions).toBe(3);
      });

      it('keeps the record retrievable, and out of the performance read model', async () => {
        const { cycleId, fresh } = await scaffoldMixed();
        const pause = await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'PAUSE', reason: 'Sin profundidad' }),
        );
        const keep = await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'KEEP' }),
        );

        // The durable record is the point: a PAUSE is retrievable, with the rule that
        // stopped the engine attached to it.
        await expect(port.getDecision(pause.id)).resolves.toMatchObject({
          action: 'PAUSE',
          reason: 'Sin profundidad',
          cycleId,
        });
        await expect(port.getDecision(keep.id)).resolves.toMatchObject({ action: 'KEEP' });
        expect(await port.listDecisionsByCycle(cycleId)).toHaveLength(2);

        // What they are NOT is performance: a decision that could not be executed has no
        // fill and no realized spread to report, so it is not a read-model row.
        expect(await port.getDecisionPerformance()).toEqual([]);
      });

      it('never lets the verification figures exceed the journaled ones', async () => {
        const { cycleId, fresh, stale } = await scaffoldMixed();
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: fresh.id, action: 'UPDATE' }),
        );
        await port.appendDecision(
          decisionInput({ cycleId, snapshotId: stale.id, action: 'KEEP' }),
        );

        const s = await port.getVerificationSummary();

        // The invariants a reader of the panel relies on, asserted together.
        expect(s.totalDecisions).toBeLessThanOrEqual(s.journaledDecisions);
        expect(s.staleDecisions).toBeLessThanOrEqual(s.journaledDecisions);
        expect(s.verifiedDecisions).toBeLessThanOrEqual(s.totalDecisions);
        expect(s.decisionsAwaitingOutcome).toBe(s.totalDecisions - s.verifiedDecisions);
      });
    });
  });

  describe('defensive copies', () => {
    it('never hands out a reference to its internal state', async () => {
      const cycleId = (await port.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 1 })).id;
      const snapshot: MarketSnapshot = await port.appendMarketSnapshot(marketInput());
      const decision = await port.appendDecision(
        decisionInput({ cycleId, snapshotId: snapshot.id }),
      );

      expect((await port.getCycle(cycleId))).not.toBe(await port.getCycle(cycleId));
      expect((await port.getDecision(decision.id))).not.toBe(
        await port.getDecision(decision.id),
      );
      expect((await port.listCycles())[0]).not.toBe((await port.getCycle(cycleId)));
    });
  });
});

describe('realizedCycleFigures', () => {
  const outcome = (overrides: Partial<DecisionOutcome> = {}): DecisionOutcome => ({
    id: 1,
    decisionId: 1,
    source: 'LOCAL_SIGNAL',
    success: true,
    filledAmountUsdt: 100,
    filledPrice: 385,
    realizedSpreadPct: 2,
    realizedProfitUsdt: 1.5,
    externalRef: null,
    detail: null,
    recordedAt: FIXED_EPOCH_MS,
    createdAt: FIXED_EPOCH_MS,
    ...overrides,
  });

  it('refuses to produce figures for a cycle with no outcomes instead of inventing zeros', () => {
    expect(realizedCycleFigures([])).toBeNull();
  });

  it('refuses when no outcome reports a realized spread (a publish attempt is not a fill)', () => {
    const outcomes = [
      outcome({ realizedSpreadPct: null, filledAmountUsdt: 0 }),
      outcome({ id: 2, success: false, realizedSpreadPct: null, filledAmountUsdt: 0 }),
    ];
    expect(realizedCycleFigures(outcomes)).toBeNull();
  });

  it('refuses when no outcome reports a realized profit', () => {
    const outcomes = [outcome({ realizedProfitUsdt: null })];
    expect(realizedCycleFigures(outcomes)).toBeNull();
  });

  it('sums reported profit and weights the spread by filled notional across the cycle', () => {
    const outcomes = [
      outcome({ filledAmountUsdt: 100, realizedSpreadPct: 2, realizedProfitUsdt: 1.8 }),
      outcome({ id: 2, decisionId: 2, filledAmountUsdt: 300, realizedSpreadPct: 3, realizedProfitUsdt: 6 }),
    ];
    expect(realizedCycleFigures(outcomes)).toEqual({
      realizedProfitUsdt: 7.8,
      realizedSpreadPct: 2.75,
    });
  });

  it('falls back to the plain mean when no reporting outcome has a fill behind it', () => {
    const outcomes = [
      outcome({ filledAmountUsdt: 0, realizedSpreadPct: 1, realizedProfitUsdt: 0.4 }),
      outcome({ id: 2, filledAmountUsdt: 0, realizedSpreadPct: 2, realizedProfitUsdt: 0.6 }),
    ];
    expect(realizedCycleFigures(outcomes)).toEqual({
      realizedProfitUsdt: 1,
      realizedSpreadPct: 1.5,
    });
  });

  it('ignores outcomes that report no spread when weighting the cycle', () => {
    const outcomes = [
      outcome({ filledAmountUsdt: 100, realizedSpreadPct: 2, realizedProfitUsdt: 1.8 }),
      outcome({
        id: 2,
        success: false,
        filledAmountUsdt: 100,
        realizedSpreadPct: null,
        realizedProfitUsdt: null,
      }),
    ];
    expect(realizedCycleFigures(outcomes)).toEqual({
      realizedProfitUsdt: 1.8,
      realizedSpreadPct: 2,
    });
  });

  it('produces exactly the read model figures for the outcomes of a single decision', async () => {
    const local = new InMemoryDecisionJournalRepository();
    const cycle = await local.openCycle({ origin: 'OPERATOR', capitalReservedUsdt: 500 });
    const snapshot = await local.appendMarketSnapshot(marketInput());
    const decision = await local.appendDecision(
      decisionInput({ cycleId: cycle.id, snapshotId: snapshot.id }),
    );
    await local.appendOutcome(
      outcomeInput({ decisionId: decision.id, filledAmountUsdt: 100, realizedSpreadPct: 2, realizedProfitUsdt: 1.8 }),
    );
    await local.appendOutcome(
      outcomeInput({
        decisionId: decision.id,
        filledAmountUsdt: 300,
        realizedSpreadPct: 3,
        realizedProfitUsdt: 6,
      }),
    );

    const [row] = await local.getDecisionPerformance();
    const outcomes = await local.listOutcomesByDecision(decision.id);

    expect(realizedCycleFigures(outcomes)).toEqual({
      realizedProfitUsdt: row!.realizedProfitUsdt,
      realizedSpreadPct: row!.realizedSpreadPct,
    });
  });
});
