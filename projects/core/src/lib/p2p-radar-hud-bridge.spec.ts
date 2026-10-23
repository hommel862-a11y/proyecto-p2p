import { describe, expect, it, vi } from 'vitest';
import {
  buildRadarHudPayload,
  RadarHudBroadcaster,
  createCompletedCycleRecord,
  consolidateDailyCycles,
  formatToDateKey,
  type RadarCompletedCycleRecord,
} from './p2p-radar-hud-bridge';
import type { RadarCleanBook } from './p2p-radar-clean-mode';
import type { MatrixScanResult } from './p2p-radar-spread-engine';

describe('p2p-radar-hud-bridge', () => {
  describe('buildRadarHudPayload', () => {
    it('constructs compact HUD payload with targets and detected bots', () => {
      const books = new Map<string, RadarCleanBook>();
      books.set('Banesco_BUY', {
        side: 'BUY',
        payMethod: 'Banesco',
        userTier: 'VERIFIED',
        cleanOffers: [],
        rejectedOffers: [],
        rawCount: 1,
        cleanCount: 1,
        rejectedCount: 0,
        effectiveTopPrice: 98.5,
        makerFeePct: 0.2,
        takerFeePct: 0.0,
        isHybridEligible: true,
      });
      books.set('Banesco_SELL', {
        side: 'SELL',
        payMethod: 'Banesco',
        userTier: 'VERIFIED',
        cleanOffers: [],
        rejectedOffers: [],
        rawCount: 1,
        cleanCount: 1,
        rejectedCount: 0,
        effectiveTopPrice: 101.5,
        makerFeePct: 0.2,
        takerFeePct: 0.0,
        isHybridEligible: true,
      });

      const matrixResult: MatrixScanResult = {
        allRoutes: [],
        topRoutes: [
          {
            routeId: 'Banesco_TO_Banesco',
            sourceBank: 'Banesco',
            targetBank: 'Banesco',
            isInterbank: false,
            sellPrice: 101.5,
            buyPrice: 98.5,
            executionMode: 'DOBLE_MAKER',
            metrics: {
              grossSpreadPct: 3.05,
              netSpreadPct: 2.64,
              grossProfitUsdt: 30.5,
              netProfitUsdt: 26.4,
              netProfitFiat: 2679.6,
              breakEvenSellPrice: 98.89,
              breakEvenBuyPrice: 101.09,
              targetSellPrice: 99.24,
              targetBuyPrice: 100.74,
              totalFeesUsdt: 4.1,
              fiatFrictionCostFiat: 0,
              totalMultiplier: 1.0264,
              isViable: true,
            },
            rank: 1,
          },
        ],
        bestRoute: null,
        scannedBanksCount: 1,
        scannedPairsCount: 1,
        viableRoutesCount: 1,
        timestampMs: Date.now(),
      };

      const botReports = new Map();
      botReports.set('Banesco_SELL', [
        {
          advertiserNo: 'BOT-99',
          nickName: 'BotKing',
          botType: 'BOT_GUERRA_CENTAVOS',
          confidenceScore: 85,
          priceStepAverage: 0.01,
          reactionTimeSecondsAverage: 12,
          updateCountInWindow: 4,
          estimatedLimitPrice: 100.5,
          recommendedCounterPrice: 100.51,
          details: 'Guerra de centavos',
        },
      ]);

      const payload = buildRadarHudPayload({
        radarBooks: books,
        matrixResult,
        botReports,
        marketTrends: new Map(),
        userTier: 'VERIFIED',
        executionMode: 'DOBLE_MAKER',
        operatingCapitalUsdt: 1000,
        targetNetMarginPct: 0.35,
        activeBanks: ['Banesco'],
      });

      expect(payload.version).toBe('1.0.0');
      expect(payload.userTier).toBe('VERIFIED');
      expect(payload.bestRoute).toBeDefined();
      expect(payload.bestRoute?.netSpreadPct).toBe(2.64);
      expect(payload.bankTargetRates['Banesco']).toBeDefined();
      expect(payload.bankTargetRates['Banesco'].effectiveBuyPrice).toBe(98.5);
      expect(payload.detectedBots.length).toBe(1);
      expect(payload.detectedBots[0].advertiserNo).toBe('BOT-99');
    });
  });

  describe('RadarHudBroadcaster', () => {
    it('manages BroadcastChannel posting and stores last payload', () => {
      const postMessageSpy = vi.fn();
      const closeSpy = vi.fn();

      class MockBroadcastChannel {
        postMessage = postMessageSpy;
        close = closeSpy;
      }

      vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

      const broadcaster = new RadarHudBroadcaster('test_channel');
      const samplePayload = {
        version: '1.0.0',
        timestampMs: 123456,
        userTier: 'UNVERIFIED' as const,
        executionMode: 'DOBLE_MAKER' as const,
        operatingCapitalUsdt: 500,
        targetNetMarginPct: 0.35,
        bestRoute: null,
        topRoutes: [],
        bankTargetRates: {},
        detectedBots: [],
        activeBanks: ['Banesco'],
      };

      broadcaster.broadcast(samplePayload);
      expect(postMessageSpy).toHaveBeenCalledWith(samplePayload);
      expect(broadcaster.getLastPayload()).toBe(samplePayload);

      broadcaster.close();
      expect(closeSpy).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('Accounting Isolation: Completed Cycle Journal', () => {
    it('creates immutable completed cycle record with accurate dateKey and rounding', () => {
      const record = createCompletedCycleRecord({
        sourceBank: 'Banesco',
        targetBank: 'Mercantil',
        executionMode: 'DOBLE_MAKER',
        capitalUsdt: 1200.555,
        buyPrice: 98.4555,
        sellPrice: 101.2555,
        netSpreadPct: 2.455,
        netProfitUsdt: 29.475,
        netProfitFiat: 2984.555,
      });

      expect(record.cycleId).toContain('CYC-');
      expect(record.isInterbank).toBe(true);
      expect(record.capitalUsdt).toBe(1200.56);
      expect(record.buyPrice).toBe(98.4555);
      expect(record.sellPrice).toBe(101.2555);
      expect(record.netProfitUsdt).toBe(29.48);
      expect(record.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('consolidates daily completed cycles into isolated summary', () => {
      const today = formatToDateKey(new Date());
      const yesterday = '2026-10-15';

      const records: RadarCompletedCycleRecord[] = [
        {
          cycleId: 'CYC-1',
          timestampMs: 1000,
          dateKey: today,
          sourceBank: 'Banesco',
          targetBank: 'Banesco',
          isInterbank: false,
          executionMode: 'DOBLE_MAKER',
          capitalUsdt: 1000,
          buyPrice: 98.0,
          sellPrice: 100.0,
          netSpreadPct: 1.63,
          netProfitUsdt: 16.3,
          netProfitFiat: 1630.0,
        },
        {
          cycleId: 'CYC-2',
          timestampMs: 2000,
          dateKey: today,
          sourceBank: 'Banesco',
          targetBank: 'Mercantil',
          isInterbank: true,
          executionMode: 'DOBLE_MAKER',
          capitalUsdt: 2000,
          buyPrice: 98.0,
          sellPrice: 101.0,
          netSpreadPct: 2.34,
          netProfitUsdt: 46.8,
          netProfitFiat: 4726.8,
        },
        // Old record from yesterday - must be excluded
        {
          cycleId: 'CYC-OLD',
          timestampMs: 500,
          dateKey: yesterday,
          sourceBank: 'BDV',
          targetBank: 'BDV',
          isInterbank: false,
          executionMode: 'DOBLE_MAKER',
          capitalUsdt: 500,
          buyPrice: 97.0,
          sellPrice: 99.0,
          netSpreadPct: 1.5,
          netProfitUsdt: 7.5,
          netProfitFiat: 742.5,
        },
      ];

      const summary = consolidateDailyCycles(records, today);

      expect(summary.dateKey).toBe(today);
      expect(summary.totalCycles).toBe(2);
      expect(summary.totalTurnoverUsdt).toBe(3000);
      expect(summary.totalNetProfitUsdt).toBe(63.1);
      expect(summary.monobankCyclesCount).toBe(1);
      expect(summary.interbankCyclesCount).toBe(1);
      expect(summary.bestSpreadPct).toBe(2.34);
      expect(summary.averageNetSpreadPct).toBe(1.99); // (1.63 + 2.34) / 2 = 1.985 -> 1.99
    });

    it('returns clean zero summary when no cycles match the date', () => {
      const summary = consolidateDailyCycles([], '2026-10-17');
      expect(summary.totalCycles).toBe(0);
      expect(summary.totalNetProfitUsdt).toBe(0);
      expect(summary.averageNetSpreadPct).toBe(0);
    });
  });
});
