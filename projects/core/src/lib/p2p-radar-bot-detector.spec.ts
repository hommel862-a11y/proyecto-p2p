import { describe, expect, it } from 'vitest';
import {
  SnapshotRingBuffer,
  calculateCleanVWAP,
  calculateEMA,
  evaluateMarketTrend,
  detectBotsInHistory,
  type BookSnapshot,
} from './p2p-radar-bot-detector';
import type { CleanRadarOffer } from './p2p-radar-clean-mode';

const MOCK_CLEAN_OFFERS: CleanRadarOffer[] = [
  {
    advNo: 'ADV-1',
    advertiserNo: 'USR-1',
    nickName: 'Trader1',
    price: 100.0,
    surplusAmount: 500, // weight: 50,000
    minSingleTransAmount: 1000,
    maxSingleTransAmount: 50000,
    monthOrderCount: 100,
    monthFinishRate: 98,
    payTimeLimit: 15,
    isMerchant: true,
    isClean: true,
    isOutlier: false,
    verdict: { passed: true, reasons: [] },
  },
  {
    advNo: 'ADV-2',
    advertiserNo: 'USR-2',
    nickName: 'Trader2',
    price: 102.0,
    surplusAmount: 500, // weight: 51,000
    minSingleTransAmount: 1000,
    maxSingleTransAmount: 50000,
    monthOrderCount: 100,
    monthFinishRate: 98,
    payTimeLimit: 15,
    isMerchant: true,
    isClean: true,
    isOutlier: false,
    verdict: { passed: true, reasons: [] },
  },
];

describe('p2p-radar-bot-detector', () => {
  describe('SnapshotRingBuffer', () => {
    it('maintains fixed capacity and drops oldest elements on overflow', () => {
      const buffer = new SnapshotRingBuffer(3);
      expect(buffer.size).toBe(0);

      const makeSnap = (id: number): BookSnapshot => ({
        payMethod: 'Banesco',
        side: 'BUY',
        timestampMs: 1000 + id,
        entries: [],
      });

      buffer.push(makeSnap(1));
      buffer.push(makeSnap(2));
      buffer.push(makeSnap(3));
      expect(buffer.size).toBe(3);
      expect(buffer.getSnapshots()[0].timestampMs).toBe(1001);

      // Push 4th element -> drops 1st
      buffer.push(makeSnap(4));
      expect(buffer.size).toBe(3);
      expect(buffer.getSnapshots()[0].timestampMs).toBe(1002);
      expect(buffer.getSnapshots()[2].timestampMs).toBe(1004);
    });
  });

  describe('calculateCleanVWAP', () => {
    it('computes volume-weighted average price accurately', () => {
      // (100 * 500 + 102 * 500) / 1000 = 101.0
      const vwap = calculateCleanVWAP(MOCK_CLEAN_OFFERS, 5);
      expect(vwap).toBe(101.0);
    });

    it('returns 0 for empty array', () => {
      expect(calculateCleanVWAP([], 5)).toBe(0);
    });
  });

  describe('calculateEMA', () => {
    it('calculates exponential moving average over sequence', () => {
      const series = [10, 11, 12, 13, 14, 15];
      const ema = calculateEMA(series, 3);
      expect(ema).toBeGreaterThan(10);
      expect(ema).toBeLessThanOrEqual(15);
    });
  });

  describe('evaluateMarketTrend', () => {
    it('classifies strong upward trend as ALCISTA', () => {
      // Rising sequence: 95, 96, 97, 98, 99, 100, 101, 102, 103, 104
      const series = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104];
      const result = evaluateMarketTrend(series, 'Banesco', 'BUY');
      expect(result.trend).toBe('ALCISTA');
      expect(result.diffPct).toBeGreaterThan(0.12);
    });

    it('classifies strong downward trend as BAJISTA', () => {
      // Falling sequence
      const series = [105, 104, 103, 102, 101, 100, 99, 98, 97, 96];
      const result = evaluateMarketTrend(series, 'Banesco', 'SELL');
      expect(result.trend).toBe('BAJISTA');
      expect(result.diffPct).toBeLessThan(-0.12);
    });

    it('classifies steady sequence as LATERAL', () => {
      const series = [100.0, 100.02, 99.98, 100.01, 100.0, 100.01];
      const result = evaluateMarketTrend(series, 'Banesco', 'BUY');
      expect(result.trend).toBe('LATERAL');
    });
  });

  describe('detectBotsInHistory', () => {
    it('identifies BOT_GUERRA_CENTAVOS when price changes in ±0.01 increments repeatedly', () => {
      const now = Date.now();
      const snapshots: BookSnapshot[] = [
        {
          payMethod: 'Banesco',
          side: 'SELL',
          timestampMs: now - 30_000,
          entries: [
            {
              advNo: 'ADV-BOT',
              advertiserNo: 'BOT-1',
              nickName: 'CentavoMaster',
              price: 99.5,
              surplusAmount: 500,
              timestampMs: now - 30_000,
              rank: 1,
            },
          ],
        },
        {
          payMethod: 'Banesco',
          side: 'SELL',
          timestampMs: now - 18_000,
          entries: [
            {
              advNo: 'ADV-BOT',
              advertiserNo: 'BOT-1',
              nickName: 'CentavoMaster',
              price: 99.49, // -0.01
              surplusAmount: 500,
              timestampMs: now - 18_000,
              rank: 1,
            },
          ],
        },
        {
          payMethod: 'Banesco',
          side: 'SELL',
          timestampMs: now - 5_000,
          entries: [
            {
              advNo: 'ADV-BOT',
              advertiserNo: 'BOT-1',
              nickName: 'CentavoMaster',
              price: 99.48, // -0.01 again
              surplusAmount: 500,
              timestampMs: now - 5_000,
              rank: 1,
            },
          ],
        },
      ];

      const bots = detectBotsInHistory(snapshots, 'SELL');
      expect(bots.length).toBe(1);
      const bot = bots[0];
      expect(bot.botType).toBe('BOT_GUERRA_CENTAVOS');
      expect(bot.confidenceScore).toBe(85);
      expect(bot.estimatedLimitPrice).toBe(99.48);
      // For SELL, bot floor is 99.48, recommended counter is floor + 0.01 = 99.49
      expect(bot.recommendedCounterPrice).toBe(99.49);
    });

    it('identifies BOT_ALTA_FRECUENCIA when rates mutate > 3 times without volume variation', () => {
      const now = Date.now();
      const snapshots: BookSnapshot[] = [
        {
          payMethod: 'Mercantil',
          side: 'BUY',
          timestampMs: now - 50_000,
          entries: [
            {
              advNo: 'ADV-HFT',
              advertiserNo: 'HFT-USER',
              nickName: 'SpeedTrader',
              price: 98.1,
              surplusAmount: 1000,
              timestampMs: now - 50_000,
              rank: 1,
            },
          ],
        },
        {
          payMethod: 'Mercantil',
          side: 'BUY',
          timestampMs: now - 40_000,
          entries: [
            {
              advNo: 'ADV-HFT',
              advertiserNo: 'HFT-USER',
              nickName: 'SpeedTrader',
              price: 98.15,
              surplusAmount: 1000,
              timestampMs: now - 40_000,
              rank: 1,
            },
          ],
        },
        {
          payMethod: 'Mercantil',
          side: 'BUY',
          timestampMs: now - 25_000,
          entries: [
            {
              advNo: 'ADV-HFT',
              advertiserNo: 'HFT-USER',
              nickName: 'SpeedTrader',
              price: 98.2,
              surplusAmount: 1000,
              timestampMs: now - 25_000,
              rank: 1,
            },
          ],
        },
        {
          payMethod: 'Mercantil',
          side: 'BUY',
          timestampMs: now - 10_000,
          entries: [
            {
              advNo: 'ADV-HFT',
              advertiserNo: 'HFT-USER',
              nickName: 'SpeedTrader',
              price: 98.25,
              surplusAmount: 1000,
              timestampMs: now - 10_000,
              rank: 1,
            },
          ],
        },
      ];

      const bots = detectBotsInHistory(snapshots, 'BUY');
      expect(bots.length).toBe(1);
      const bot = bots[0];
      expect(bot.botType).toBe('BOT_ALTA_FRECUENCIA');
      expect(bot.confidenceScore).toBe(80);
      expect(bot.estimatedLimitPrice).toBe(98.25);
      // For BUY, bot ceiling is 98.25, recommended counter is ceiling - 0.01 = 98.24
      expect(bot.recommendedCounterPrice).toBe(98.24);
    });
  });
});
