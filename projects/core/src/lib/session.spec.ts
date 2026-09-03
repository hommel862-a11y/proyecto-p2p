import { describe, it, expect } from 'vitest';
import {
  computeSessionSummary,
  aggregateSessions,
  getOperationsForSession,
  type TradingSession,
} from './session';
import { type Operation } from './log';

describe('TradingSession Core Logic', () => {
  const sessionActive: TradingSession = {
    id: 'sess-1',
    startTime: '2026-07-15T10:00:00.000Z',
    targetOps: 5,
    notes: 'Morning shift',
  };

  const sessionClosed: TradingSession = {
    id: 'sess-2',
    startTime: '2026-07-15T14:00:00.000Z',
    endTime: '2026-07-15T16:00:00.000Z', // 2 hours
    disciplineRating: 5,
    notes: 'Afternoon shift',
  };

  const mockOps: Operation[] = [
    {
      id: 'op-1',
      timestamp: '2026-07-15T14:15:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 8000,
      usdtAmount: 10,
      price: 800,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      durationMs: 120_000, // 2 minutes
      sessionId: 'sess-2',
    },
    {
      id: 'op-2',
      timestamp: '2026-07-15T14:45:00.000Z',
      type: 'sell',
      pair: 'USDT',
      vesAmount: 8400,
      usdtAmount: 10,
      price: 840,
      merchantNote: '',
      fees: 10,
      notes: '',
      errorFree: true,
      durationMs: 180_000, // 3 minutes
      sessionId: 'sess-2',
    },
    {
      id: 'op-3',
      timestamp: '2026-07-15T11:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 4000,
      usdtAmount: 5,
      price: 800,
      merchantNote: '',
      fees: 0,
      notes: '',
      errorFree: true,
      sessionId: 'sess-1',
    },
  ];

  it('filters operations correctly by sessionId', () => {
    const ops = getOperationsForSession(sessionClosed, mockOps);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.id)).toEqual(['op-1', 'op-2']);
  });

  it('computes session summary with accurate duration, PnL and turnover velocity', () => {
    const summary = computeSessionSummary(sessionClosed, mockOps);
    expect(summary.isOpen).toBe(false);
    expect(summary.durationMs).toBe(7_200_000); // 2 hours
    expect(summary.operationsCount).toBe(2);
    expect(summary.pnlVes).toBe(390); // 8400 - 8000 - 10 = 390
    expect(summary.volumeUsdt).toBe(20);
    // Average operation duration: (120k + 180k) / 2 = 150_000 ms (2.5 mins)
    expect(summary.avgOpDurationMs).toBe(150_000);
    // 2 ops in 2 hours -> 1.0 ops/hour
    expect(summary.turnoverRatePerHour).toBe(1);
  });

  it('handles active session duration relative to reference time', () => {
    const refNow = '2026-07-15T11:00:00.000Z'; // 1 hour after start
    const summary = computeSessionSummary(sessionActive, mockOps, refNow);
    expect(summary.isOpen).toBe(true);
    expect(summary.durationMs).toBe(3_600_000); // 1 hour
    expect(summary.operationsCount).toBe(1);
  });

  it('aggregates multiple sessions newest first', () => {
    const aggregated = aggregateSessions([sessionActive, sessionClosed], mockOps);
    expect(aggregated).toHaveLength(2);
    expect(aggregated[0].session.id).toBe('sess-2'); // 14:00 > 10:00
    expect(aggregated[1].session.id).toBe('sess-1');
  });
});
