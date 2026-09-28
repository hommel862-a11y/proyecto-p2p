import { describe, it, expect } from 'vitest';
import {
  DECISION_SIDES,
  DECISION_ORIGINS,
  DECISION_CYCLE_STATUSES,
  DECISION_EXECUTION_MODES,
  OUTCOME_SOURCES,
} from './decision-journal';
import type {
  DecisionAction,
  DecisionCycleCloseStatus,
  DecisionCycleStatus,
  DecisionOrigin,
  DecisionSide,
  DecisionPerformanceRow,
  MarketSnapshot,
  OutcomeSource,
  RepricerDecisionRecord,
  RepricerExecutionMode,
  VerificationSummary,
} from './decision-journal';
import type { RepricerDecision } from './repricer';

/**
 * Compile-time equality helper. `Expect<Equals<A, B>>` only compiles when the
 * two types are mutually identical, so these guards fail the build the moment a
 * union drifts from the literal set the SQLite CHECK constraints will use.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _SideMatchesRuntimeArray = Expect<
  Equals<DecisionSide, (typeof DECISION_SIDES)[number]>
>;
type _OriginMatchesRuntimeArray = Expect<
  Equals<DecisionOrigin, (typeof DECISION_ORIGINS)[number]>
>;
type _CycleStatusMatchesRuntimeArray = Expect<
  Equals<DecisionCycleStatus, (typeof DECISION_CYCLE_STATUSES)[number]>
>;
type _OutcomeSourceMatchesRuntimeArray = Expect<
  Equals<OutcomeSource, (typeof OUTCOME_SOURCES)[number]>
>;
type _ExecutionModeMatchesRuntimeArray = Expect<
  Equals<RepricerExecutionMode, (typeof DECISION_EXECUTION_MODES)[number]>
>;
type _CloseStatusIsATerminalSubset = Expect<
  Equals<DecisionCycleCloseStatus, 'CLOSED' | 'ABANDONED'>
>;
type _ActionIsReusedFromTheRepricer = Expect<
  Equals<DecisionAction, RepricerDecision['action']>
>;

describe('Decision Journal domain contract', () => {
  describe('literal sets (single source of truth for SQL CHECK constraints)', () => {
    it('exposes exactly the two sides', () => {
      expect([...DECISION_SIDES]).toEqual(['BUY', 'SELL']);
    });

    it('exposes exactly the four decision origins', () => {
      expect([...DECISION_ORIGINS]).toEqual([
        'OPERATOR',
        'AUTO_ENGINE',
        'MCP_AGENT',
        'STRATEGY_PLAN',
      ]);
    });

    it('exposes exactly the three cycle statuses', () => {
      expect([...DECISION_CYCLE_STATUSES]).toEqual(['OPEN', 'CLOSED', 'ABANDONED']);
    });

    it('exposes exactly the four outcome sources', () => {
      expect([...OUTCOME_SOURCES]).toEqual([
        'LOCAL_SIGNAL',
        'BINANCE_MERCHANT',
        'CSV_IMPORT',
        'MANUAL',
      ]);
    });

    it('exposes exactly the two real execution modes', () => {
      expect([...DECISION_EXECUTION_MODES]).toEqual(['READ_ONLY', 'PUBLISHING']);
    });
  });

  describe('MarketSnapshot', () => {
    const snapshot: MarketSnapshot = {
      id: 7,
      obi: -0.42,
      bidUsd: 0.0092,
      askUsd: 0.0094,
      nBids: 8,
      nAsks: 6,
      stale: true,
      fetchedAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_500,
    };

    it('models a normalized observation of the order book, not the raw payload', () => {
      expect(snapshot.obi).toBeGreaterThanOrEqual(-1);
      expect(snapshot.obi).toBeLessThanOrEqual(1);
      expect(snapshot.nBids).toBe(8);
      expect(snapshot.nAsks).toBe(6);
    });

    it('carries an explicit stale flag so old data can be audited later', () => {
      expect(snapshot.stale).toBe(true);
    });
  });

  describe('RepricerDecisionRecord', () => {
    const record: RepricerDecisionRecord = {
      id: 3,
      cycleId: 'cycle_1',
      snapshotId: 7,
      side: 'BUY',
      decisionPrice: 385.5,
      origin: 'AUTO_ENGINE',
      executionMode: 'PUBLISHING',
      action: 'UPDATE',
      modeledSpreadPct: 1.2,
      reason: 'Repriced to stay Top 1',
      safetyFlags: [],
      observedObi: -0.42,
      observedBidUsd: 0.0092,
      observedAskUsd: 0.0094,
      observedStale: true,
      accountId: 'banes-01',
      planId: 'plan-01',
      createdAt: 1_700_000_001_000,
    };

    it('records the real execution mode instead of inferring it', () => {
      expect(record.executionMode).toBe('PUBLISHING');
    });

    it('records the observed market context denormalized on the decision', () => {
      expect(record.observedObi).toBe(-0.42);
      expect(record.observedStale).toBe(true);
    });

    it('keeps account and plan as optional soft references', () => {
      expect(record.accountId).toBe('banes-01');
      expect(record.planId).toBe('plan-01');
    });
  });

  describe('DecisionPerformanceRow', () => {
    it('models an unfilled decision with a zero fill count and null realized values', () => {
      const row: DecisionPerformanceRow = {
        decisionId: 3,
        cycleId: 'cycle_1',
        side: 'SELL',
        origin: 'OPERATOR',
        executionMode: 'READ_ONLY',
        decisionPrice: 386,
        modeledSpreadPct: 1.1,
        observedStale: false,
        observedObi: 0.1,
        fillCount: 0,
        realizedSpreadPct: null,
        realizedProfitUsdt: null,
        filledAmountUsdt: null,
        decidedAt: 1_700_000_001_000,
      };
      expect(row.fillCount).toBe(0);
      expect(row.realizedSpreadPct).toBeNull();
      expect(row.realizedProfitUsdt).toBeNull();
    });
  });

  describe('VerificationSummary', () => {
    it('holds rates as 0..1 ratios, not percentages', () => {
      const summary: VerificationSummary = {
        totalDecisions: 4,
        verifiedDecisions: 3,
        verificationRate: 0.75,
        staleDecisions: 1,
        staleRate: 0.25,
        openCycles: 1,
        decisionsAwaitingOutcome: 1,
      };
      expect(summary.verificationRate).toBeGreaterThanOrEqual(0);
      expect(summary.verificationRate).toBeLessThanOrEqual(1);
      expect(summary.staleRate).toBeGreaterThanOrEqual(0);
      expect(summary.staleRate).toBeLessThanOrEqual(1);
    });
  });
});
