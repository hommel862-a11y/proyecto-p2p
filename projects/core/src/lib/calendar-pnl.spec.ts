import { describe, it, expect } from 'vitest';
import { buildCalendarMonthView } from './calendar-pnl';
import { type Operation } from './log';

describe('buildCalendarMonthView', () => {
  it('builds an empty calendar month view when no operations exist', () => {
    const view = buildCalendarMonthView([], 2026, 9);
    expect(view.year).toBe(2026);
    expect(view.month).toBe(9);
    expect(view.monthName).toBe('Septiembre');
    expect(view.totalDays).toBe(30);
    expect(view.activeTradingDays).toBe(0);
    expect(view.winRatePct).toBe(0);
    expect(view.totalPnlVes).toBe(0);
  });

  it('aggregates daily trading cycles, PnL and computes heatLevel correctly', () => {
    const sampleOps: Operation[] = [
      {
        id: 'op-1',
        type: 'buy',
        usdtAmount: 1000,
        price: 60.0,
        vesAmount: 60000,
        fees: 0,
        pair: 'USDT',
        merchantNote: '',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-05T10:00:00.000Z',
      },
      {
        id: 'op-2',
        type: 'sell',
        usdtAmount: 1000,
        price: 61.0,
        vesAmount: 61000,
        fees: 50,
        pair: 'USDT',
        merchantNote: '',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-05T14:00:00.000Z',
      },
    ];

    const view = buildCalendarMonthView(sampleOps, 2026, 9, 60.0);
    expect(view.activeTradingDays).toBe(1);
    expect(view.profitableDays).toBe(1);
    expect(view.winRatePct).toBe(100);
    expect(view.totalOperations).toBe(2);
    expect(view.totalCycles).toBe(1);
    expect(view.totalPnlVes).toBe(950); // 61000 - 60000 - 50 = 950

    const day5 = view.days.find((d) => d?.dayOfMonth === 5);
    expect(day5).toBeDefined();
    expect(day5?.operationsCount).toBe(2);
    expect(day5?.completedCycles).toBe(1);
    expect(day5?.pnlVes).toBe(950);
    expect(day5?.heatLevel).toBeGreaterThanOrEqual(3);
  });

  it('excludes assign operations from daily aggregates and counts', () => {
    const ops: Operation[] = [
      {
        id: 'buy-1',
        type: 'buy',
        usdtAmount: 500,
        price: 60.0,
        vesAmount: 30000,
        fees: 0,
        pair: 'USDT',
        merchantNote: '',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-10T09:00:00.000Z',
      },
      {
        id: 'sell-1',
        type: 'sell',
        usdtAmount: 500,
        price: 61.0,
        vesAmount: 30500,
        fees: 30,
        pair: 'USDT',
        merchantNote: '',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-10T11:00:00.000Z',
      },
      {
        id: 'assign-1',
        type: 'assign',
        usdtAmount: 0,
        price: 0,
        vesAmount: 10000,
        fees: 0,
        pair: 'USDT',
        merchantNote: 'Fondeo tesorería',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-10T12:00:00.000Z',
      },
    ];

    const view = buildCalendarMonthView(ops, 2026, 9, 60.0);

    const day10 = view.days.find((d) => d?.dayOfMonth === 10);
    expect(day10).toBeDefined();
    expect(day10?.operationsCount).toBe(2);
    expect(day10?.buyCount).toBe(1);
    expect(day10?.sellCount).toBe(1);
    expect(day10?.volumeUsdt).toBe(1000);
    expect(day10?.pnlVes).toBe(470); // (30500-30)-30000 = 470
    expect(day10?.feesVes).toBe(30);

    const controlOps: Operation[] = [ops[0], ops[1]];
    const controlView = buildCalendarMonthView(controlOps, 2026, 9, 60.0);
    const controlDay10 = controlView.days.find((d) => d?.dayOfMonth === 10);
    expect(day10?.operationsCount).toBe(controlDay10?.operationsCount);
    expect(day10?.buyCount).toBe(controlDay10?.buyCount);
    expect(day10?.sellCount).toBe(controlDay10?.sellCount);
    expect(day10?.pnlVes).toBe(controlDay10?.pnlVes);
    expect(day10?.volumeUsdt).toBe(controlDay10?.volumeUsdt);
    expect(day10?.feesVes).toBe(controlDay10?.feesVes);
  });
});
