import { describe, it, expect } from 'vitest';
import { computeFifoAccounting } from './inventory-accounting';
import type { Operation } from './log';

function mockOp(over: Partial<Operation>): Operation {
  return {
    id: 'op-' + Math.random().toString(36).slice(2, 7),
    timestamp: '2026-01-01T10:00:00.000Z',
    type: 'buy',
    pair: 'USDT',
    vesAmount: 0,
    usdtAmount: 0,
    price: 0,
    merchantNote: '',
    fees: 0,
    notes: '',
    errorFree: true,
    ...over,
  };
}

describe('computeFifoAccounting', () => {
  it('Scenario 1: Complete round-trip buy and sell yields positive realized PnL and 0 open inventory', () => {
    const ops: Operation[] = [
      mockOp({ id: 'b1', timestamp: '2026-01-01T10:00:00Z', type: 'buy', usdtAmount: 100, price: 900, vesAmount: 90000 }),
      mockOp({ id: 's1', timestamp: '2026-01-01T11:00:00Z', type: 'sell', usdtAmount: 100, price: 950, vesAmount: 95000 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.realizedPnlVes).toBe(5000);
    expect(result.openInventoryAmount).toBe(0);
    expect(result.openInventoryCostBasisVes).toBe(0);
    expect(result.closedVolumeUsdt).toBe(100);
    expect(result.winRatePct).toBe(100);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].grossPnlVes).toBe(5000);
  });

  it('Scenario 2 (The Critical Flaw): Partial sale correctly reports POSITIVE realized profit instead of false loss', () => {
    // Buy 1,000 USDT @ 900 VES (cost: 900,000 VES)
    // Sell 500 USDT @ 950 VES (proceeds: 475,000 VES)
    // In old broken cash flow, this was 475,000 - 900,000 = -425,000 VES!
    // In real FIFO accounting: Sold 500 USDT. Cost = 500 * 900 = 450,000. Profit = 475,000 - 450,000 = +25,000 VES!
    const ops: Operation[] = [
      mockOp({ id: 'b1', timestamp: '2026-01-01T10:00:00Z', type: 'buy', usdtAmount: 1000, price: 900, vesAmount: 900000 }),
      mockOp({ id: 's1', timestamp: '2026-01-01T11:00:00Z', type: 'sell', usdtAmount: 500, price: 950, vesAmount: 475000 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.realizedPnlVes).toBe(25000); // TRUE REALIZED PROFIT
    expect(result.netCashFlowVes).toBe(-425000); // CASH FLOW (preserved for treasury)
    expect(result.capitalDeployedVes).toBe(425000); // Capital deployed in open inventory
    expect(result.openInventoryAmount).toBe(500); // 500 USDT still held
    expect(result.openInventoryCostBasisVes).toBe(450000); // Remaining 500 USDT cost basis @ 900
    expect(result.openInventoryAvgPriceVes).toBe(900);
    expect(result.closedVolumeUsdt).toBe(500);
  });

  it('Scenario 3: Multi-lot FIFO matching respects chronological order', () => {
    // Lot 1: Buy 100 @ 900
    // Lot 2: Buy 100 @ 920
    // Sell 150 @ 960 -> Closes 100 of Lot 1 (gain 6,000) and 50 of Lot 2 (gain 2,000) -> Total gain = 8,000 VES
    const ops: Operation[] = [
      mockOp({ id: 'b1', timestamp: '2026-01-01T09:00:00Z', type: 'buy', usdtAmount: 100, price: 900, vesAmount: 90000 }),
      mockOp({ id: 'b2', timestamp: '2026-01-01T10:00:00Z', type: 'buy', usdtAmount: 100, price: 920, vesAmount: 92000 }),
      mockOp({ id: 's1', timestamp: '2026-01-01T11:00:00Z', type: 'sell', usdtAmount: 150, price: 960, vesAmount: 144000 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.realizedPnlVes).toBe(8000);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].matchedAmount).toBe(100);
    expect(result.matches[0].openingPriceVes).toBe(900);
    expect(result.matches[0].grossPnlVes).toBe(6000);

    expect(result.matches[1].matchedAmount).toBe(50);
    expect(result.matches[1].openingPriceVes).toBe(920);
    expect(result.matches[1].grossPnlVes).toBe(2000);

    // Remaining 50 USDT in Lot 2 @ 920
    expect(result.openInventoryAmount).toBe(50);
    expect(result.openInventoryCostBasisVes).toBe(46000);
    expect(result.openInventoryAvgPriceVes).toBe(920);
  });

  it('Scenario 4: Maker replenishment (Sell first, then Buy lower) matches and records gain', () => {
    // Maker sells 50 USDT @ 960 (receives 48,000 VES)
    // Maker buys 50 USDT @ 910 (spends 45,500 VES)
    // Realized profit = +2,500 VES
    const ops: Operation[] = [
      mockOp({ id: 's1', timestamp: '2026-01-01T08:00:00Z', type: 'sell', usdtAmount: 50, price: 960, vesAmount: 48000 }),
      mockOp({ id: 'b1', timestamp: '2026-01-01T09:00:00Z', type: 'buy', usdtAmount: 50, price: 910, vesAmount: 45500 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.realizedPnlVes).toBe(2500);
    expect(result.openInventoryAmount).toBe(0);
    expect(result.closedVolumeUsdt).toBe(50);
    expect(result.winRatePct).toBe(100);
  });

  it('Scenario 5: Deducts trading fees from realized PnL', () => {
    const ops: Operation[] = [
      mockOp({ id: 'b1', timestamp: '2026-01-01T10:00:00Z', type: 'buy', usdtAmount: 100, price: 900, vesAmount: 90000, fees: 50 }),
      mockOp({ id: 's1', timestamp: '2026-01-01T11:00:00Z', type: 'sell', usdtAmount: 100, price: 950, vesAmount: 95000, fees: 75 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.totalFeesVes).toBe(125);
    expect(result.realizedPnlVes).toBe(5000 - 125); // 4,875 VES
  });

  it('Scenario 6: Isolates trading pairs (USDT lots do not collide with EUR lots)', () => {
    const ops: Operation[] = [
      mockOp({ id: 'b-usdt', timestamp: '2026-01-01T10:00:00Z', type: 'buy', pair: 'USDT', usdtAmount: 100, price: 900, vesAmount: 90000 }),
      mockOp({ id: 'b-eur', timestamp: '2026-01-01T10:05:00Z', type: 'buy', pair: 'EUR', usdtAmount: 50, price: 1000, vesAmount: 50000 }),
      mockOp({ id: 's-usdt', timestamp: '2026-01-01T11:00:00Z', type: 'sell', pair: 'USDT', usdtAmount: 100, price: 950, vesAmount: 95000 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.realizedPnlVes).toBe(5000); // USDT profit only
    expect(result.closedVolumeUsdt).toBe(100);
    expect(result.openLots).toHaveLength(1);
    expect(result.openLots[0].pair).toBe('EUR');
    expect(result.openLots[0].remainingAmount).toBe(50);
  });

  it('Scenario 7: Ignores assign treasury deposits without affecting lots or PnL', () => {
    const ops: Operation[] = [
      mockOp({ id: 'a1', timestamp: '2026-01-01T08:00:00Z', type: 'assign', vesAmount: 500000 }),
    ];

    const result = computeFifoAccounting(ops);

    expect(result.operationsCount).toBe(0);
    expect(result.realizedPnlVes).toBe(0);
    expect(result.openInventoryAmount).toBe(0);
  });
});
