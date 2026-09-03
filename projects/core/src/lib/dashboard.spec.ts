import { describe, it, expect } from 'vitest';
import { computeDashboard } from './dashboard';
import { type Operation } from './log';

describe('computeDashboard', () => {
  it('handles empty operation ledger', () => {
    const res = computeDashboard([]);
    expect(res.totalOps).toBe(0);
    expect(res.today.operations).toBe(0);
    expect(res.week).toHaveLength(7);
    expect(res.recentOps).toHaveLength(0);
  });

  it('aggregates today operations correctly', () => {
    const today = new Date().toISOString();
    const ops: Operation[] = [
      {
        id: '1',
        timestamp: today,
        type: 'buy',
        pair: 'USDT',
        vesAmount: 8000,
        usdtAmount: 10,
        price: 800,
        merchantNote: 'Merchant A',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '2',
        timestamp: today,
        type: 'sell',
        pair: 'USDT',
        vesAmount: 8500,
        usdtAmount: 10,
        price: 850,
        merchantNote: 'Merchant B',
        fees: 50,
        notes: '',
        errorFree: true,
      },
    ];

    const res = computeDashboard(ops);
    expect(res.totalOps).toBe(2);
    expect(res.today.operations).toBe(2);
    expect(res.today.pnlVes).toBe(450); // 8500 - 8000 - 50 = 450
    expect(res.recentOps).toHaveLength(2);
  });

  it('returns maximum 3 recent operations ordered newest first', () => {
    const ops: Operation[] = [
      {
        id: '1',
        timestamp: '2026-01-01T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 100,
        usdtAmount: 1,
        price: 100,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '2',
        timestamp: '2026-01-02T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 100,
        usdtAmount: 1,
        price: 100,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '3',
        timestamp: '2026-01-03T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 100,
        usdtAmount: 1,
        price: 100,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
      },
      {
        id: '4',
        timestamp: '2026-01-04T10:00:00.000Z',
        type: 'buy',
        pair: 'USDT',
        vesAmount: 100,
        usdtAmount: 1,
        price: 100,
        merchantNote: '',
        fees: 0,
        notes: '',
        errorFree: true,
      },
    ];

    const res = computeDashboard(ops);
    expect(res.recentOps).toHaveLength(3);
    expect(res.recentOps[0].id).toBe('4');
    expect(res.recentOps[1].id).toBe('3');
    expect(res.recentOps[2].id).toBe('2');
  });
});
