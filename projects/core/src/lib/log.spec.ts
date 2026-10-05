import { describe, it, expect } from 'vitest';
import {
  computeLogSummary,
  filterOpsByOperator,
  computeOperatorSummary,
  type Operation,
} from './log';

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
    operatorId: 'op-alpha',
    operatorName: 'Ana López',
    ...over,
  };
}

function opWithOperator(operatorId: string, operatorName: string): Operation {
  return {
    id: 'op-' + operatorId,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'buy',
    pair: 'USDT',
    vesAmount: 1000,
    usdtAmount: 1.25,
    price: 800,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: true,
    operatorId,
    operatorName,
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
    expect(
      computeLogSummary([op({ errorFree: true }), op({ errorFree: true })]).zeroErrorStreak,
    ).toBe(2);
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

  it('calculates true realized PnL via FIFO on partial fills without false negative cashflow', () => {
    // Buy 1,000 USDT @ 900 VES = 900,000 VES cost basis
    // Sell 500 USDT @ 950 VES = 475,000 VES proceeds
    // Legacy cashflow was 475k - 900k = -425k (falsely indicating a loss)
    // Institutional FIFO yields (950 - 900) * 500 = +25,000 VES realized profit
    const ops: Operation[] = [
      op({ id: 'buy-1', type: 'buy', vesAmount: 900000, usdtAmount: 1000, price: 900 }),
      op({ id: 'sell-1', type: 'sell', vesAmount: 475000, usdtAmount: 500, price: 950 }),
    ];
    const summary = computeLogSummary(ops);
    expect(summary.pnlVes).toBe(25000);
    expect(summary.exposure).toBe(500); // 500 USDT held
    expect(summary.capitalDeployed).toBe(425000); // 425k VES still deployed in inventory
    expect(summary.fifo).toBeDefined();
    expect(summary.fifo.realizedPnlVes).toBe(25000);
    expect(summary.fifo.openInventoryAmount).toBe(500);
    expect(summary.fifo.openInventoryCostBasisVes).toBe(450000);
    expect(summary.fifo.openInventoryAvgPriceVes).toBe(900);
    expect(summary.fifo.winRatePct).toBe(100);
  });
});

describe('filterOpsByOperator and computeOperatorSummary', () => {
  const alphaOps: Operation[] = [
    opWithOperator('op-alpha', 'Ana López'),
    opWithOperator('op-alpha', 'Ana López'),
  ];
  const betaOps: Operation[] = [opWithOperator('op-beta', 'Carlos Pérez')];
  const allOps: Operation[] = [...alphaOps, ...betaOps];

  it('returns all ops when operatorId is undefined', () => {
    const filtered = filterOpsByOperator(allOps);
    expect(filtered).toHaveLength(3);
  });

  it('filters ops by operatorId', () => {
    const filtered = filterOpsByOperator(allOps, 'op-alpha');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((o) => o.operatorId === 'op-alpha')).toBe(true);
  });

  it('returns empty array when operatorId has no matching ops', () => {
    const filtered = filterOpsByOperator(allOps, 'op-gamma');
    expect(filtered).toHaveLength(0);
  });

  it('computeOperatorSummary returns PnL for a specific operator', () => {
    // alpha: buy 1000 VES each x 2 -> total buy = 2000
    const summary = computeOperatorSummary(allOps, 'op-alpha');
    expect(summary.operations).toBe(2);
    expect(summary.capitalDeployed).toBe(2000);
  });

  it('computeOperatorSummary returns all when operatorId is undefined', () => {
    const summary = computeOperatorSummary(allOps);
    expect(summary.operations).toBe(3);
    expect(summary.capitalDeployed).toBe(3000); // 3 buys @ 1000 VES each
  });
});
