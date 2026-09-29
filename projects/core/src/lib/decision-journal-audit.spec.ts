import { describe, it, expect } from 'vitest';
import { buildDecisionSelfAudit } from './decision-journal-audit';
import type { DecisionPerformanceRow, VerificationSummary } from './decision-journal';

const NOW = new Date('2026-02-03T12:00:00.000Z').getTime();

const row = (overrides: Partial<DecisionPerformanceRow> = {}): DecisionPerformanceRow => ({
  decisionId: 1,
  cycleId: 'cycle-1',
  side: 'BUY',
  origin: 'AUTO_ENGINE',
  executionMode: 'READ_ONLY',
  decisionPrice: 385.5,
  modeledSpreadPct: 1.2,
  observedStale: false,
  observedObi: 0.25,
  fillCount: 0,
  realizedSpreadPct: null,
  realizedProfitUsdt: null,
  filledAmountUsdt: null,
  decidedAt: NOW,
  ...overrides,
});

const summary = (overrides: Partial<VerificationSummary> = {}): VerificationSummary => ({
  totalDecisions: 0,
  verifiedDecisions: 0,
  verificationRate: 0,
  journaledDecisions: 0,
  staleDecisions: 0,
  staleRate: 0,
  openCycles: 0,
  decisionsAwaitingOutcome: 0,
  ...overrides,
});

/**
 * Folds rows and the summary of the *same* filter, the way the facade does.
 *
 * `totalDecisions` tracks the rows because the read model enumerates exactly the
 * verifiable decisions. `journaledDecisions` defaults to the same number unless a test
 * says otherwise, so tests that only care about verification do not have to restate it.
 */
const auditFor = (
  rows: readonly DecisionPerformanceRow[],
  overrides: Partial<VerificationSummary> = {},
) =>
  buildDecisionSelfAudit(
    rows,
    summary({ totalDecisions: rows.length, journaledDecisions: rows.length, ...overrides }),
  );

describe('buildDecisionSelfAudit', () => {
  it('reports both sides even when the journal is empty', () => {
    const audit = buildDecisionSelfAudit([], summary());

    expect(audit.sides.map((side) => side.side)).toEqual(['BUY', 'SELL']);
    expect(audit.sides[0]).toEqual({
      side: 'BUY',
      decisions: 0,
      medianModeledSpreadPct: null,
      medianRealizedSpreadPct: null,
      decisionsWithReportedSpread: 0,
    });
    expect(audit.verification).toEqual({
      totalDecisions: 0,
      decisionsWithRecordedAttempt: 0,
      recordedAttemptRate: 0,
      decisionsAwaitingOutcome: 0,
      openCycles: 0,
    });
    expect(audit.staleExposure).toEqual({
      totalDecisions: 0,
      decisionsOnStaleMarket: 0,
      staleRate: 0,
    });
  });

  it('takes the median of an odd count of modeled spreads per side', () => {
    const rows = [
      row({ decisionId: 1, side: 'BUY', modeledSpreadPct: 1 }),
      row({ decisionId: 2, side: 'BUY', modeledSpreadPct: 3 }),
      row({ decisionId: 3, side: 'BUY', modeledSpreadPct: 9 }),
    ];

    const buy = auditFor(rows).sides.find((s) => s.side === 'BUY');
    expect(buy?.decisions).toBe(3);
    expect(buy?.medianModeledSpreadPct).toBe(3);
  });

  it('averages the two middle values for an even count', () => {
    const rows = [
      row({ decisionId: 1, side: 'SELL', modeledSpreadPct: 1 }),
      row({ decisionId: 2, side: 'SELL', modeledSpreadPct: 2 }),
      row({ decisionId: 3, side: 'SELL', modeledSpreadPct: 8 }),
      row({ decisionId: 4, side: 'SELL', modeledSpreadPct: 20 }),
    ];

    const sell = auditFor(rows).sides.find((s) => s.side === 'SELL');
    expect(sell?.medianModeledSpreadPct).toBe(5);
  });

  it('keeps the modeled median on the same side as the decisions it describes', () => {
    const rows = [
      row({ decisionId: 1, side: 'BUY', modeledSpreadPct: 40 }),
      row({ decisionId: 2, side: 'SELL', modeledSpreadPct: 0.1 }),
    ];

    const audit = auditFor(rows);
    expect(audit.sides.find((s) => s.side === 'BUY')?.medianModeledSpreadPct).toBe(40);
    expect(audit.sides.find((s) => s.side === 'SELL')?.medianModeledSpreadPct).toBe(0.1);
  });

  it('computes the realized median only over the decisions that reported one', () => {
    const rows = [
      row({ decisionId: 1, side: 'BUY', fillCount: 1, realizedSpreadPct: 1.5 }),
      row({ decisionId: 2, side: 'BUY', fillCount: 0, realizedSpreadPct: null }),
      row({ decisionId: 3, side: 'BUY', fillCount: 1, realizedSpreadPct: 2.5 }),
    ];

    const buy = auditFor(rows).sides.find((s) => s.side === 'BUY');
    expect(buy?.decisionsWithReportedSpread).toBe(2);
    expect(buy?.medianRealizedSpreadPct).toBe(2);
  });

  it('reports a null realized median when nothing on that side reported a spread', () => {
    const rows = [row({ decisionId: 1, side: 'BUY', fillCount: 1, realizedSpreadPct: null })];

    const buy = auditFor(rows).sides.find((s) => s.side === 'BUY');
    expect(buy?.decisionsWithReportedSpread).toBe(0);
    expect(buy?.medianRealizedSpreadPct).toBeNull();
  });

  it('exposes the verification ratio as recorded attempts, keeping the backlog visible', () => {
    const audit = auditFor([row(), row({ decisionId: 2 }), row({ decisionId: 3 })], {
      verifiedDecisions: 1,
      verificationRate: 0.3333,
      openCycles: 2,
      decisionsAwaitingOutcome: 2,
    });

    expect(audit.verification).toEqual({
      totalDecisions: 3,
      decisionsWithRecordedAttempt: 1,
      recordedAttemptRate: 0.3333,
      decisionsAwaitingOutcome: 2,
      openCycles: 2,
    });
  });

  it('exposes the stale-data exposure as a 0..1 rate', () => {
    const audit = auditFor([row({ observedStale: true }), row({ decisionId: 2 })], {
      staleDecisions: 1,
      staleRate: 0.5,
    });

    expect(audit.staleExposure).toEqual({
      totalDecisions: 2,
      decisionsOnStaleMarket: 1,
      staleRate: 0.5,
    });
  });

  it('counts the stale-data exposure over every journaled decision, not the verifiable ones', () => {
    // The trap, at the audit layer. One UPDATE row is the whole read model, but the
    // journal behind it holds three decisions and two of them were taken on a stale
    // book. Both KEEP/PAUSE rows are invisible here, so the ONLY way this audit can
    // report the engine's real stale exposure is by taking its denominator from
    // `journaledDecisions`.
    const audit = auditFor([row()], {
      totalDecisions: 1,
      journaledDecisions: 3,
      staleDecisions: 2,
      staleRate: 2 / 3,
    });

    expect(audit.staleExposure).toEqual({
      totalDecisions: 3,
      decisionsOnStaleMarket: 2,
      staleRate: 2 / 3,
    });
    // ...while verification keeps its narrower denominator, so the two blocks of the
    // same audit are allowed to disagree about how many decisions exist.
    expect(audit.verification.totalDecisions).toBe(1);
  });

  it('refuses to mix rows and summary that came from different filters', () => {
    expect(() => buildDecisionSelfAudit([row()], summary({ totalDecisions: 4 }))).toThrow(
      /same DecisionPerformanceFilter/,
    );
  });
});
