/**
 * Pure domain logic for historical P2P market spread snapshots (framework-agnostic).
 * Computes rolling retention, average/min/max spread metrics, and market trends.
 */

export interface MarketDataPoint {
  timestamp: string; // ISO 8601
  pair: 'USDT' | 'EUR';
  bank: string;
  bestBuyPrice: number;
  bestSellPrice: number;
  spreadVes: number;
  spreadPct: number;
}

export type SpreadTrend = 'EXPANDING' | 'COMPRESSING' | 'STABLE';

export interface MarketHistoryStats {
  averageSpreadVes: number;
  maxSpreadVes: number;
  minSpreadVes: number;
  totalPoints: number;
  trend: SpreadTrend;
  lastSpreadVes: number;
}

/**
 * Appends a new market snapshot maintaining a chronological rolling window up to `maxPoints`.
 */
export function addSnapshotToHistory(
  history: readonly MarketDataPoint[],
  point: MarketDataPoint,
  maxPoints = 200,
): MarketDataPoint[] {
  if (!point || point.spreadVes === undefined || isNaN(point.spreadVes)) {
    return [...history];
  }

  // Deduplicate if timestamp and spread are identical to the last item
  const last = history[history.length - 1];
  if (
    last &&
    last.timestamp === point.timestamp &&
    last.bank === point.bank &&
    last.pair === point.pair
  ) {
    return [...history];
  }

  const updated = [...history, point];
  if (updated.length > maxPoints) {
    return updated.slice(updated.length - maxPoints);
  }
  return updated;
}

/**
 * Calculates statistical metrics and short-term volatility trend over a series of market snapshots.
 */
export function calculateHistoryStats(history: readonly MarketDataPoint[]): MarketHistoryStats {
  if (!history || history.length === 0) {
    return {
      averageSpreadVes: 0,
      maxSpreadVes: 0,
      minSpreadVes: 0,
      totalPoints: 0,
      trend: 'STABLE',
      lastSpreadVes: 0,
    };
  }

  let sum = 0;
  let max = -Infinity;
  let min = Infinity;

  for (const item of history) {
    sum += item.spreadVes;
    if (item.spreadVes > max) max = item.spreadVes;
    if (item.spreadVes < min) min = item.spreadVes;
  }

  const average = Number((sum / history.length).toFixed(2));
  const lastPoint = history[history.length - 1];
  const lastSpread = lastPoint ? lastPoint.spreadVes : 0;

  // Trend determination based on the last 3-5 snapshots vs earlier average
  let trend: SpreadTrend = 'STABLE';
  if (history.length >= 3) {
    const recentWindow = history.slice(-3);
    const recentAvg = recentWindow.reduce((acc, p) => acc + p.spreadVes, 0) / recentWindow.length;
    const delta = recentAvg - average;
    const threshold = Math.max(average * 0.05, 0.5); // 5% shift or at least 0.5 VES

    if (delta > threshold) {
      trend = 'EXPANDING';
    } else if (delta < -threshold) {
      trend = 'COMPRESSING';
    }
  }

  return {
    averageSpreadVes: average,
    maxSpreadVes: max === -Infinity ? 0 : Number(max.toFixed(2)),
    minSpreadVes: min === Infinity ? 0 : Number(min.toFixed(2)),
    totalPoints: history.length,
    trend,
    lastSpreadVes: lastSpread,
  };
}

/**
 * Filters market data points for a specific bank or returns all if bank is 'ALL'.
 */
export function filterHistoryByBank(
  history: readonly MarketDataPoint[],
  bank: string,
): MarketDataPoint[] {
  if (!bank || bank === 'ALL') {
    return [...history];
  }
  const target = bank.toUpperCase();
  return history.filter((p) => p.bank.toUpperCase() === target);
}
