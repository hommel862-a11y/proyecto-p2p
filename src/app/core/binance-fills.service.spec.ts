import '@angular/compiler';
import { Injector } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BinanceFillsService } from './binance-fills.service';
import { DecisionJournalService } from './decision-journal.service';
import { ToastService } from './toast.service';
import { CredentialStoreService } from './credential-store.service';
import type { RepricerDecisionRecord, RecordOutcomeInput } from '@p2p/core';

describe('BinanceFillsService', () => {
  let service: BinanceFillsService;
  let mockToast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let mockJournal: {
    listCycles: ReturnType<typeof vi.fn>;
    listDecisionsByCycle: ReturnType<typeof vi.fn>;
    listOutcomesByDecision: ReturnType<typeof vi.fn>;
    appendOutcome: ReturnType<typeof vi.fn>;
  };
  let mockCredentials: {
    getBinanceCredentials: ReturnType<typeof vi.fn>;
  };

  const sampleDecision: RepricerDecisionRecord = {
    id: 42,
    cycleId: 'CYCLE-2026-001',
    snapshotId: 10,
    side: 'BUY',
    decisionPrice: 88.5,
    origin: 'AUTO_ENGINE',
    executionMode: 'PUBLISHING',
    action: 'UPDATE',
    modeledSpreadPct: 1.2,
    reason: 'Top maker bid',
    safetyFlags: [],
    observedObi: 0.2,
    observedBidUsd: 88.5,
    observedAskUsd: 89.8,
    observedStale: false,
    createdAt: new Date('2026-09-28 10:35:00').getTime(),
  };

  beforeEach(() => {
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    mockJournal = {
      listCycles: vi.fn().mockResolvedValue([{ id: 'CYCLE-2026-001', status: 'OPEN' }]),
      listDecisionsByCycle: vi.fn().mockResolvedValue([sampleDecision]),
      listOutcomesByDecision: vi.fn().mockResolvedValue([]),
      appendOutcome: vi.fn().mockResolvedValue({ id: 1 }),
    };

    mockCredentials = {
      getBinanceCredentials: vi.fn().mockResolvedValue({ apiKey: 'mock-key', apiSecret: 'mock-secret' }),
    };

    const injector = Injector.create({
      providers: [
        { provide: ToastService, useValue: mockToast },
        { provide: DecisionJournalService, useValue: mockJournal },
        { provide: CredentialStoreService, useValue: mockCredentials },
        BinanceFillsService,
      ],
    });

    service = injector.get(BinanceFillsService);
  });

  afterEach(() => {
    delete (globalThis as { electron?: unknown }).electron;
  });

  describe('importCsv', () => {
    it('parses CSV lines and appends verified outcomes to the DecisionJournal', async () => {
      const csv = `Order Number,Order Type,Asset Type,Fiat Type,Total Price,Unit Price,Quantity,Order Status,Created Time,Counterparty
202609280050,BUY,USDT,VES,8850.00,88.50,100.00,COMPLETED,2026-09-28 10:40:00,ArbitragistaX`;

      const summary = await service.importCsv(csv);

      expect(summary.recordedCount).toBe(1);
      expect(summary.skippedCount).toBe(0);
      expect(mockJournal.appendOutcome).toHaveBeenCalledTimes(1);

      const recorded = mockJournal.appendOutcome.mock.calls[0][0] as RecordOutcomeInput;
      expect(recorded.decisionId).toBe(42);
      expect(recorded.externalRef).toBe('202609280050');
      expect(recorded.filledAmountUsdt).toBe(100);
      expect(recorded.filledPrice).toBe(88.5);
      expect(recorded.success).toBe(true);
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('handles empty or invalid CSV files with graceful error notification', async () => {
      const summary = await service.importCsv('invalid-header\n');
      expect(summary.recordedCount).toBe(0);
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  describe('syncFromApi', () => {
    it('queries electron bridge and records fetched fills', async () => {
      (globalThis as { electron?: unknown }).electron = {
        fetchBinanceC2cOrders: vi.fn().mockResolvedValue({
          data: [
            {
              orderNumber: 'API-C2C-001',
              advNo: 'ADV-BUY-01',
              tradeType: 'BUY',
              asset: 'USDT',
              fiat: 'VES',
              amount: '250.00',
              totalPrice: '22125.00',
              unitPrice: '88.50',
              orderStatus: 'COMPLETED',
              createTime: new Date('2026-09-28 10:40:00').getTime(),
              commission: '0.25',
              counterPartNickName: 'ProTrader',
            },
          ],
        }),
      };

      const summary = await service.syncFromApi('BUY', 'CYCLE-2026-001');

      expect(summary.recordedCount).toBe(1);
      expect(mockJournal.appendOutcome).toHaveBeenCalledTimes(1);
      const recorded = mockJournal.appendOutcome.mock.calls[0][0] as RecordOutcomeInput;
      expect(recorded.externalRef).toBe('API-C2C-001');
      expect(recorded.filledAmountUsdt).toBe(250);
      expect(mockToast.success).toHaveBeenCalled();
    });

    it('reports clear error if Binance credentials are not configured', async () => {
      mockCredentials.getBinanceCredentials.mockResolvedValue(null);

      const summary = await service.syncFromApi();
      expect(summary.recordedCount).toBe(0);
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining('Credenciales de Binance no configuradas'),
        'Fills de Binance P2P',
      );
    });
  });
});
