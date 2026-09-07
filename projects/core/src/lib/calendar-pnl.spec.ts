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
});
