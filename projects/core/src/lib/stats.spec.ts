import { describe, it, expect } from 'vitest';
import { computeStats } from './stats';
import { type Operation } from './log';

function op(p: Partial<Operation> & { timestamp: string; type: 'buy' | 'sell' }): Operation {
  return {
    id: Math.random().toString(36).slice(2),
    vesAmount: 0,
    usdtAmount: 0,
    price: 0,
    merchantNote: '',
    notes: '',
    errorFree: true,
    fees: 0,
    ...p,
  } as Operation;
}

describe('computeStats', () => {
  const ops: Operation[] = [
    op({ timestamp: '2026-01-01T10:00:00.000Z', type: 'sell', usdtAmount: 10, vesAmount: 8200, fees: 5 }),
    op({ timestamp: '2026-01-15T10:00:00.000Z', type: 'sell', usdtAmount: 10, vesAmount: 8300, fees: 5 }),
    op({ timestamp: '2026-02-01T10:00:00.000Z', type: 'buy', usdtAmount: 10, vesAmount: 8000, fees: 5 }),
    op({ timestamp: '2026-04-10T10:00:00.000Z', type: 'sell', usdtAmount: 10, vesAmount: 8400, fees: 5 }),
  ];

  it('buckets by day', () => {
    const s = computeStats(ops);
    expect(s.daily.length).toBe(4);
    const jan1 = s.daily.find((d) => d.period === '2026-01-01')!;
    expect(jan1.operations).toBe(1);
    expect(jan1.pnlVes).toBeCloseTo(8200 - 5);
  });

  it('buckets by month', () => {
    const s = computeStats(ops);
    expect(s.monthly.length).toBe(3);
    const jan = s.monthly.find((m) => m.period === '2026-01')!;
    expect(jan.operations).toBe(2);
    expect(jan.pnlVes).toBeCloseTo(8200 - 5 + (8300 - 5));
  });

  it('buckets by quarter', () => {
    const s = computeStats(ops);
    expect(s.quarterly.length).toBe(2);
    const q1 = s.quarterly.find((q) => q.period === '2026-Q1')!;
    expect(q1.operations).toBe(3);
    expect(q1.pnlVes).toBeCloseTo(8200 - 5 + (8300 - 5) + (-8000 - 5));
  });

  it('sorts newest first', () => {
    const s = computeStats(ops);
    expect(s.quarterly[0].period).toBe('2026-Q2');
    expect(s.monthly[0].period).toBe('2026-04');
  });

  it('converts PnL to USDT using the bucket average price', () => {
    const s = computeStats([op({ timestamp: '2026-03-01T10:00:00.000Z', type: 'sell', usdtAmount: 10, vesAmount: 8200, fees: 0 })]);
    const m = s.monthly[0];
    expect(m.pnlUsdt).toBeCloseTo(10); // 8200 VES / 820 VES per USDT = 10 USDT
  });

  it('handles empty input', () => {
    const e = computeStats([]);
    expect(e.daily).toEqual([]);
    expect(e.monthly).toEqual([]);
    expect(e.quarterly).toEqual([]);
  });

  it('tolerates non-array input', () => {
    const z = computeStats(undefined as unknown as Operation[]);
    expect(z.daily).toEqual([]);
    expect(z.quarterly).toEqual([]);
  });
});
