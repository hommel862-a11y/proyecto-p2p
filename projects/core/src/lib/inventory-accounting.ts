/**
 * Pure institutional FIFO (First-In, First-Out) Inventory Accounting for P2P Desks.
 * Distinguishes Realized Profit & Loss (PnL on closed trades) from Net Cash Flow / Capital Deployed.
 * Framework-agnostic: pure deterministic TypeScript, no Angular, no side effects.
 */

import type { Operation } from './log';

export interface InventoryLot {
  readonly id: string;
  readonly opId: string;
  readonly timestamp: string;
  readonly pair: 'USDT' | 'EUR';
  readonly side: 'BUY' | 'SELL';
  readonly originalAmount: number;
  remainingAmount: number;
  readonly unitPriceVes: number;
  readonly totalVes: number;
}

export interface TradeMatchRecord {
  readonly closingOpId: string;
  readonly openingOpId: string;
  readonly pair: 'USDT' | 'EUR';
  readonly matchedAmount: number;
  readonly openingPriceVes: number;
  readonly closingPriceVes: number;
  readonly grossPnlVes: number;
  readonly grossPnlUsdt: number;
  readonly isWin: boolean;
}

export interface FifoAccountingSummary {
  /** Total operations inspected (excluding assign deposits). */
  readonly operationsCount: number;
  /** Realized PnL in VES on closed lots, minus all trading fees. */
  readonly realizedPnlVes: number;
  /** Realized PnL in USDT/foreign currency. */
  readonly realizedPnlUsdt: number;
  /** Net cash flow in VES = Σ sell proceeds − Σ buy costs − Σ fees. */
  readonly netCashFlowVes: number;
  /** Net capital deployed in VES = Σ buy costs − Σ sell proceeds. */
  readonly capitalDeployedVes: number;
  /** Total trading fees paid in VES. */
  readonly totalFeesVes: number;
  /** Total crypto volume matched and closed via FIFO. */
  readonly closedVolumeUsdt: number;
  /** Open crypto inventory held (positive = long, negative = short). */
  readonly openInventoryAmount: number;
  /** Total acquisition cost basis of remaining open inventory in VES. */
  readonly openInventoryCostBasisVes: number;
  /** Volume-weighted average price of open inventory. */
  readonly openInventoryAvgPriceVes: number;
  /** Percentage of closed trade matches with positive gross profit (0..100). */
  readonly winRatePct: number;
  /** Profit factor = gross profits / gross losses. Infinity if no losses. */
  readonly profitFactor: number;
  /** Detailed list of closed lot matches. */
  readonly matches: readonly TradeMatchRecord[];
  /** Remaining open lots. */
  readonly openLots: readonly InventoryLot[];
}

/**
 * Computes institutional FIFO inventory cost basis and realized PnL across operations.
 * Pure, deterministic and chronology-aware.
 */
export function computeFifoAccounting(ops: readonly Operation[]): FifoAccountingSummary {
  // Filter out non-trade assignments and sort chronologically (stable)
  const tradeOps = (Array.isArray(ops) ? ops : [])
    .filter((o) => o.type === 'buy' || o.type === 'sell')
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let totalBuyVes = 0;
  let totalSellVes = 0;
  let totalBuyUsdt = 0;
  let totalSellUsdt = 0;
  let totalFeesVes = 0;

  // Separate lot queues by trading pair
  const openLongLotsByPair = new Map<string, InventoryLot[]>();
  const openShortLotsByPair = new Map<string, InventoryLot[]>();

  const matches: TradeMatchRecord[] = [];

  for (const op of tradeOps) {
    const pair = op.pair || 'USDT';
    const amount = Number(op.usdtAmount) || 0;
    const recordedVes = Number(op.vesAmount) || 0;
    const fee = Number(op.fees) || 0;
    totalFeesVes += fee;

    if (amount <= 0) continue;

    // Unit price resolution honoring recorded VES when present
    const unitPriceVes =
      recordedVes > 0 ? recordedVes / amount : Number(op.price) || 0;
    const effectiveVes = recordedVes > 0 ? recordedVes : amount * unitPriceVes;

    if (!openLongLotsByPair.has(pair)) openLongLotsByPair.set(pair, []);
    if (!openShortLotsByPair.has(pair)) openShortLotsByPair.set(pair, []);

    const longLots = openLongLotsByPair.get(pair)!;
    const shortLots = openShortLotsByPair.get(pair)!;

    if (op.type === 'buy') {
      totalBuyVes += effectiveVes;
      totalBuyUsdt += amount;

      let remainingBuy = amount;

      // 1. Match against open short lots first (seller replenishment / short cover)
      while (remainingBuy > 1e-8 && shortLots.length > 0) {
        const shortLot = shortLots[0];
        const matchAmt = Math.min(remainingBuy, shortLot.remainingAmount);

        const shortRevenue = matchAmt * shortLot.unitPriceVes;
        const buyCost = matchAmt * unitPriceVes;
        const grossPnl = shortRevenue - buyCost;
        const grossUsdt = unitPriceVes > 0 ? grossPnl / unitPriceVes : 0;

        matches.push({
          closingOpId: op.id,
          openingOpId: shortLot.opId,
          pair,
          matchedAmount: Math.round(matchAmt * 1e6) / 1e6,
          openingPriceVes: shortLot.unitPriceVes,
          closingPriceVes: unitPriceVes,
          grossPnlVes: Math.round(grossPnl * 100) / 100,
          grossPnlUsdt: Math.round(grossUsdt * 100) / 100,
          isWin: grossPnl > 0,
        });

        remainingBuy -= matchAmt;
        shortLot.remainingAmount -= matchAmt;

        if (shortLot.remainingAmount <= 1e-8) {
          shortLots.shift();
        }
      }

      // 2. Remaining buy volume enters long inventory lots
      if (remainingBuy > 1e-8) {
        longLots.push({
          id: `lot-${op.id}-${longLots.length}`,
          opId: op.id,
          timestamp: op.timestamp,
          pair,
          side: 'BUY',
          originalAmount: amount,
          remainingAmount: remainingBuy,
          unitPriceVes,
          totalVes: remainingBuy * unitPriceVes,
        });
      }
    } else {
      // op.type === 'sell'
      totalSellVes += effectiveVes;
      totalSellUsdt += amount;

      let remainingSell = amount;

      // 1. Match against open long lots (long inventory liquidation)
      while (remainingSell > 1e-8 && longLots.length > 0) {
        const longLot = longLots[0];
        const matchAmt = Math.min(remainingSell, longLot.remainingAmount);

        const buyCost = matchAmt * longLot.unitPriceVes;
        const sellRevenue = matchAmt * unitPriceVes;
        const grossPnl = sellRevenue - buyCost;
        const grossUsdt = unitPriceVes > 0 ? grossPnl / unitPriceVes : 0;

        matches.push({
          closingOpId: op.id,
          openingOpId: longLot.opId,
          pair,
          matchedAmount: Math.round(matchAmt * 1e6) / 1e6,
          openingPriceVes: longLot.unitPriceVes,
          closingPriceVes: unitPriceVes,
          grossPnlVes: Math.round(grossPnl * 100) / 100,
          grossPnlUsdt: Math.round(grossUsdt * 100) / 100,
          isWin: grossPnl > 0,
        });

        remainingSell -= matchAmt;
        longLot.remainingAmount -= matchAmt;

        if (longLot.remainingAmount <= 1e-8) {
          longLots.shift();
        }
      }

      // 2. Remaining sell volume enters short inventory lots (maker sold ahead of buy)
      if (remainingSell > 1e-8) {
        shortLots.push({
          id: `lot-${op.id}-${shortLots.length}`,
          opId: op.id,
          timestamp: op.timestamp,
          pair,
          side: 'SELL',
          originalAmount: amount,
          remainingAmount: remainingSell,
          unitPriceVes,
          totalVes: remainingSell * unitPriceVes,
        });
      }
    }
  }

  // Aggregate matches
  let grossProfitsVes = 0;
  let grossLossesVes = 0;
  let grossPnlVes = 0;
  let grossPnlUsdt = 0;
  let closedVolumeUsdt = 0;
  let winCount = 0;

  for (const m of matches) {
    grossPnlVes += m.grossPnlVes;
    grossPnlUsdt += m.grossPnlUsdt;
    closedVolumeUsdt += m.matchedAmount;

    if (m.grossPnlVes > 0) {
      grossProfitsVes += m.grossPnlVes;
      winCount++;
    } else if (m.grossPnlVes < 0) {
      grossLossesVes += Math.abs(m.grossPnlVes);
    }
  }

  const realizedPnlVes = Math.round((grossPnlVes - totalFeesVes) * 100) / 100;
  const realizedPnlUsdt = Math.round(grossPnlUsdt * 100) / 100;
  const netCashFlowVes = Math.round((totalSellVes - totalBuyVes - totalFeesVes) * 100) / 100;
  const capitalDeployedVes = Math.round((totalBuyVes - totalSellVes) * 100) / 100;

  // Open inventory metrics across all pairs
  const remainingLots: InventoryLot[] = [];
  let openInventoryAmount = 0;
  let openInventoryCostBasisVes = 0;

  for (const lots of openLongLotsByPair.values()) {
    for (const lot of lots) {
      if (lot.remainingAmount > 1e-8) {
        remainingLots.push(lot);
        openInventoryAmount += lot.remainingAmount;
        openInventoryCostBasisVes += lot.remainingAmount * lot.unitPriceVes;
      }
    }
  }

  for (const lots of openShortLotsByPair.values()) {
    for (const lot of lots) {
      if (lot.remainingAmount > 1e-8) {
        remainingLots.push(lot);
        openInventoryAmount -= lot.remainingAmount;
        openInventoryCostBasisVes -= lot.remainingAmount * lot.unitPriceVes;
      }
    }
  }

  const openInventoryAvgPriceVes =
    Math.abs(openInventoryAmount) > 1e-8
      ? Math.abs(openInventoryCostBasisVes / openInventoryAmount)
      : 0;

  const winRatePct =
    matches.length > 0
      ? Math.round((winCount / matches.length) * 1000) / 10
      : 0;

  const profitFactor =
    grossLossesVes > 0
      ? Math.round((grossProfitsVes / grossLossesVes) * 100) / 100
      : grossProfitsVes > 0
        ? Infinity
        : 1;

  return {
    operationsCount: tradeOps.length,
    realizedPnlVes,
    realizedPnlUsdt,
    netCashFlowVes,
    capitalDeployedVes,
    totalFeesVes: Math.round(totalFeesVes * 100) / 100,
    closedVolumeUsdt: Math.round(closedVolumeUsdt * 1e4) / 1e4,
    openInventoryAmount: Math.round(openInventoryAmount * 1e4) / 1e4,
    openInventoryCostBasisVes: Math.round(openInventoryCostBasisVes * 100) / 100,
    openInventoryAvgPriceVes: Math.round(openInventoryAvgPriceVes * 100) / 100,
    winRatePct,
    profitFactor,
    matches,
    openLots: remainingLots,
  };
}
