import { describe, it, expect } from 'vitest';
import {
  addSnapshotToHistory,
  calculateHistoryStats,
  filterHistoryByBank,
  type MarketDataPoint,
} from './spread-history';

describe('spread-history domain engine', () => {
  const samplePoint: MarketDataPoint = {
    timestamp: '2026-09-07T00:00:00.000Z',
    pair: 'USDT',
    bank: 'BANESCO',
    bestBuyPrice: 800,
    bestSellPrice: 820,
    spreadVes: 20,
    spreadPct: 2.5,
  };

  it('should append snapshots up to maxPoints', () => {
    let history: MarketDataPoint[] = [];

    history = addSnapshotToHistory(history, samplePoint, 3);
    expect(history.length).toBe(1);

    const point2 = { ...samplePoint, timestamp: '2026-09-07T00:01:00.000Z', spreadVes: 22 };
    const point3 = { ...samplePoint, timestamp: '2026-09-07T00:02:00.000Z', spreadVes: 24 };
    const point4 = { ...samplePoint, timestamp: '2026-09-07T00:03:00.000Z', spreadVes: 26 };

    history = addSnapshotToHistory(history, point2, 3);
    history = addSnapshotToHistory(history, point3, 3);
    expect(history.length).toBe(3);

    // Exceeds maxPoints of 3
    history = addSnapshotToHistory(history, point4, 3);
    expect(history.length).toBe(3);
    expect(history[0].spreadVes).toBe(22); // Oldest removed
    expect(history[2].spreadVes).toBe(26);
  });

  it('should ignore consecutive duplicate snapshots', () => {
    let history: MarketDataPoint[] = [];
    history = addSnapshotToHistory(history, samplePoint);
    history = addSnapshotToHistory(history, samplePoint);
    expect(history.length).toBe(1);
  });

  it('should calculate stats and trends accurately', () => {
    // Empty case
    const emptyStats = calculateHistoryStats([]);
    expect(emptyStats.totalPoints).toBe(0);
    expect(emptyStats.averageSpreadVes).toBe(0);
    expect(emptyStats.trend).toBe('STABLE');

    // Expanding trend series
    const series: MarketDataPoint[] = [
      { ...samplePoint, timestamp: '1', spreadVes: 10 },
      { ...samplePoint, timestamp: '2', spreadVes: 12 },
      { ...samplePoint, timestamp: '3', spreadVes: 18 },
      { ...samplePoint, timestamp: '4', spreadVes: 22 },
      { ...samplePoint, timestamp: '5', spreadVes: 25 },
    ];

    const stats = calculateHistoryStats(series);
    expect(stats.totalPoints).toBe(5);
    expect(stats.minSpreadVes).toBe(10);
    expect(stats.maxSpreadVes).toBe(25);
    expect(stats.averageSpreadVes).toBe(17.4);
    expect(stats.trend).toBe('EXPANDING');
  });

  it('should detect compressing spread trend', () => {
    const series: MarketDataPoint[] = [
      { ...samplePoint, timestamp: '1', spreadVes: 30 },
      { ...samplePoint, timestamp: '2', spreadVes: 28 },
      { ...samplePoint, timestamp: '3', spreadVes: 18 },
      { ...samplePoint, timestamp: '4', spreadVes: 14 },
      { ...samplePoint, timestamp: '5', spreadVes: 10 },
    ];

    const stats = calculateHistoryStats(series);
    expect(stats.trend).toBe('COMPRESSING');
  });

  it('should filter snapshots by bank correctly', () => {
    const list: MarketDataPoint[] = [
      { ...samplePoint, bank: 'BANESCO' },
      { ...samplePoint, bank: 'MERCANTIL' },
      { ...samplePoint, bank: 'BANESCO' },
    ];

    expect(filterHistoryByBank(list, 'ALL').length).toBe(3);
    expect(filterHistoryByBank(list, 'BANESCO').length).toBe(2);
    expect(filterHistoryByBank(list, 'BDV').length).toBe(0);
  });
});
