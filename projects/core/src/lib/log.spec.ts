import { describe, it, expect } from 'vitest';
import { computeLogSummary, type Operation } from './log';

function op(over: Partial<Operation> = {}): Operation {
  return {
    id: '1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'buy',
    pair: 'USDT',
    vesAmount: 0,
    usdtAmount: 0,
    price: 0,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: false,
    ...over,
  };
}

describe('computeLogSummary', () => {
  it('Scenario B: buy 20,000 VES / 25 USDT @800 then sell 25 USDT @820 => PnL +500 VES gross', () => {
    const ops: Operation[] = [
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', usdtAmount: 25, price: 820 }),
    ];
    const summary = computeLogSummary(ops);
    expect(summary.pnlVes).toBe(500);
  });

  it('applies fees to PnL (sell 25@820, buy 20000, 100 VES fees => 400)', () => {
    const ops: Operation[] = [
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', usdtAmount: 25, price: 820, fees: 100 }),
    ];
    expect(computeLogSummary(ops).pnlVes).toBe(400);
  });

  it('uses recorded sell vesAmount when it differs from price×usdt (slippage)', () => {
    const ops: Operation[] = [
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', vesAmount: 21000, usdtAmount: 25, price: 820 }),
    ];
    expect(computeLogSummary(ops).pnlVes).toBe(1000);
  });

  it('zero-error streak counts trailing error-free operations', () => {
    const ops: Operation[] = [
      op({ id: 'a', errorFree: true }),
      op({ id: 'b', errorFree: true }),
      op({ id: 'c', errorFree: false }),
    ];
    expect(computeLogSummary(ops).zeroErrorStreak).toBe(0);
    expect(computeLogSummary([op({ errorFree: true }), op({ errorFree: true })]).zeroErrorStreak).toBe(2);
  });

  it('exposure = net USDT; capitalDeployed = net VES', () => {
    const ops: Operation[] = [
      op({ id: 'a', type: 'buy', vesAmount: 20000, usdtAmount: 25, price: 800 }),
      op({ id: 'b', type: 'sell', usdtAmount: 25, price: 820 }),
    ];
    const summary = computeLogSummary(ops);
    expect(summary.exposure).toBe(0);
    expect(summary.capitalDeployed).toBe(-500);
  });

  it('empty log yields all-zero summary', () => {
    const summary = computeLogSummary([]);
    expect(summary.operations).toBe(0);
    expect(summary.pnlVes).toBe(0);
    expect(summary.exposure).toBe(0);
  });

  it('treasury assign operations do not disturb PnL, capital, or exposure', () => {
    const ops: Operation[] = [
      op({ id: 't', type: 'assign', vesAmount: 50000, usdtAmount: 0, price: 0, fees: 0 }),
    ];
    const summary = computeLogSummary(ops);
    expect(summary.operations).toBe(1);
    expect(summary.pnlVes).toBe(0);
    expect(summary.pnlUsdt).toBe(0);
    expect(summary.exposure).toBe(0);
    expect(summary.capitalDeployed).toBe(0);
  });
});
