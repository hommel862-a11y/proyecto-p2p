import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { FinanceAiIngestorService } from './finance-ai-ingestor.service';
import { StorageService } from '../storage';
import { CotizaveService } from '../cotizave.service';
import { SecureVaultService } from '../secure-vault.service';

interface MockCotizaveRate {
  mid?: number;
  ask?: number;
  bid?: number;
}

describe('FinanceAiIngestorService', () => {
  let service: FinanceAiIngestorService;
  let storageMap: Map<string, unknown>;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let vaultMap: Map<string, string>;
  let mockVault: {
    getSecret: ReturnType<typeof vi.fn>;
    storeSecret: ReturnType<typeof vi.fn>;
    hasSecret: ReturnType<typeof vi.fn>;
    removeSecret: ReturnType<typeof vi.fn>;
  };
  let ratesSignal: ReturnType<typeof signal<Record<string, MockCotizaveRate>>>;
  let originalElectron: unknown;

  beforeEach(() => {
    originalElectron = (window as unknown as { electron?: unknown }).electron;
    delete (window as unknown as { electron?: unknown }).electron;

    storageMap = new Map<string, unknown>();
    mockStorage = {
      get: vi.fn((key: string) => (storageMap.has(key) ? storageMap.get(key) : null)),
      set: vi.fn((key: string, val: unknown) => {
        storageMap.set(key, val);
      }),
      remove: vi.fn((key: string) => {
        storageMap.delete(key);
      }),
    };

    vaultMap = new Map<string, string>();
    mockVault = {
      getSecret: vi.fn(async (key: string) => vaultMap.get(key) ?? null),
      storeSecret: vi.fn(async (key: string, secret: string) => {
        vaultMap.set(key, secret);
      }),
      hasSecret: vi.fn(async (key: string) => vaultMap.has(key)),
      removeSecret: vi.fn(async (key: string) => {
        vaultMap.delete(key);
      }),
    };

    ratesSignal = signal<Record<string, MockCotizaveRate>>({});

    TestBed.configureTestingModule({
      providers: [
        FinanceAiIngestorService,
        { provide: StorageService, useValue: mockStorage },
        { provide: SecureVaultService, useValue: mockVault },
        { provide: CotizaveService, useValue: { ratesByMarket: ratesSignal } },
      ],
    });

    service = TestBed.inject(FinanceAiIngestorService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalElectron !== undefined) {
      (window as unknown as { electron?: unknown }).electron = originalElectron;
    } else {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });

  describe('Electron main-process proxy isolation', () => {
    it('routes analyzeReceiptImage through window.electron.finance360.aiAnalyze without touching fetch or API keys', async () => {
      ratesSignal.set({ oficial: { mid: 91.4 } });
      const aiAnalyze = vi.fn().mockResolvedValue({
        success: true,
        text: JSON.stringify({
          title: 'Compra Farmatodo',
          amount: 14.75,
          currency: 'USD',
          scope: 'personal',
          pillar: 'expense',
          expenseCategory: 'groceries',
          channel: 'bs_bank',
          referenceNumber: '882211',
          date: '2026-10-15',
          isCashea: false,
          confidence: 0.96,
        }),
      });
      (window as unknown as { electron: unknown }).electron = {
        finance360: { aiAnalyze },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.analyzeReceiptImage(
        'data:image/jpeg;base64,QUJDREVG',
        'image/jpeg',
        'Farmatodo $14.75',
      );

      expect(aiAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          inlineData: { mimeType: 'image/jpeg', data: 'QUJDREVG' },
          temperature: 0.1,
          responseMimeType: 'application/json',
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockVault.getSecret).not.toHaveBeenCalled();
      expect(mockStorage.get).not.toHaveBeenCalled();
      expect(result.title).toBe('Compra Farmatodo');
      expect(result.amount).toBe(14.75);
      expect(result.currency).toBe('USD');
      expect(result.bcvRateApplied).toBe(91.4);
      expect(result.referenceNumber).toBe('882211');
    });

    it('routes transcribeAndClassifyAudio through window.electron.finance360.aiAnalyze without calling fetch', async () => {
      ratesSignal.set({ oficial: { ask: 92.1 } });
      const aiAnalyze = vi.fn().mockResolvedValue({
        success: true,
        text: JSON.stringify({
          title: 'Pago de pintura taller',
          amount: 42.5,
          currency: 'USD',
          scope: 'business',
          pillar: 'expense',
          expenseCategory: 'provider_merchandise',
          channel: 'cash',
          date: '2026-10-15',
          isCashea: false,
          confidence: 0.93,
        }),
      });
      (window as unknown as { electron: unknown }).electron = {
        finance360: { aiAnalyze },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.transcribeAndClassifyAudio(
        'data:audio/webm;base64,QVVESU8=',
        'audio/webm;codecs=opus',
      );

      expect(aiAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.any(String),
          inlineData: { mimeType: 'audio/webm', data: 'QVVESU8=' },
          temperature: 0.1,
          responseMimeType: 'application/json',
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.title).toBe('Pago de pintura taller');
      expect(result.amount).toBe(42.5);
      expect(result.bcvRateApplied).toBe(92.1);
    });

    it('falls back to local heuristics instead of direct fetch if Electron aiAnalyze fails', async () => {
      const aiAnalyze = vi.fn().mockRejectedValue(new Error('IPC unavailable'));
      (window as unknown as { electron: unknown }).electron = {
        finance360: { aiAnalyze },
      };
      vaultMap.set('gemini_api_key', 'should-not-be-used-in-electron');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.analyzeReceiptImage(
        'QUJD',
        'image/jpeg',
        'Cashea Cuota 2 de 3 $18.75 Ref: 554433',
      );

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.isCashea).toBe(true);
      expect(result.casheaInstallmentNumber).toBe(2);
      expect(result.amount).toBe(18.75);
      expect(result.bcvRateApplied).toBe(0);
    });
  });

  describe('SecureVault key resolution and legacy plaintext migration', () => {
    it('reads gemini_api_key from SecureVaultService in web mode and sends x-goog-api-key header', async () => {
      vaultMap.set('gemini_api_key', 'vault-gemini-secret-key');
      ratesSignal.set({ oficial: { mid: 88.5 } });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: 'Factura repuestos',
                      amount: 120.5,
                      currency: 'USD',
                      scope: 'business',
                      pillar: 'expense',
                      expenseCategory: 'provider_merchandise',
                      channel: 'zelle',
                      date: '2026-10-16',
                      isCashea: false,
                      confidence: 0.91,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as Response);

      const result = await service.analyzeReceiptImage('QUJD', 'image/png', 'Factura $120.50');

      expect(mockVault.getSecret).toHaveBeenCalledWith('gemini_api_key');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).not.toContain('vault-gemini-secret-key');
      expect((calledInit?.headers as Record<string, string>)['x-goog-api-key']).toBe(
        'vault-gemini-secret-key',
      );
      expect(result.amount).toBe(120.5);
      expect(result.bcvRateApplied).toBe(88.5);
    });

    it('migrates legacy plaintext key from StorageService into SecureVaultService and removes plaintext key', async () => {
      storageMap.set('p2p.gemini.apiKey', 'legacy-plain-gemini-key');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: 'Recibo migrado',
                      amount: 25,
                      currency: 'USD',
                      scope: 'personal',
                      pillar: 'expense',
                      expenseCategory: 'other',
                      channel: 'cash',
                      date: '2026-10-16',
                      isCashea: false,
                      confidence: 0.88,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as Response);

      const result = await service.analyzeReceiptImage('QUJD', 'image/jpeg', '$25');

      expect(mockVault.storeSecret).toHaveBeenCalledWith(
        'gemini_api_key',
        'legacy-plain-gemini-key',
      );
      expect(mockStorage.remove).toHaveBeenCalledWith('p2p.gemini.apiKey');
      expect(storageMap.has('p2p.gemini.apiKey')).toBe(false);
      expect(vaultMap.get('gemini_api_key')).toBe('legacy-plain-gemini-key');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.amount).toBe(25);
    });
  });

  describe('BCV rate policy (no invented 60.0 fallback)', () => {
    it('returns bcvRateApplied = 0 when Cotizave has no oficial rate', async () => {
      ratesSignal.set({});
      const result = await service.analyzeReceiptImage('QUJD', 'image/jpeg', 'Supermercado $12.50');
      expect(result.bcvRateApplied).toBe(0);
    });

    it('uses oficial.ask when oficial.mid is absent', async () => {
      ratesSignal.set({ oficial: { ask: 95.25 } });
      const result = await service.analyzeReceiptImage('QUJD', 'image/jpeg', 'Supermercado $12.50');
      expect(result.bcvRateApplied).toBe(95.25);
    });
  });

  describe('parseWithHeuristics decimal and Cashea accuracy', () => {
    it('parses "$12.50" as 12.5 without 100x corruption', () => {
      const parsed = service.parseWithHeuristics('Compra cafe $12.50', 90);
      expect(parsed.amount).toBe(12.5);
      expect(parsed.currency).toBe('USD');
    });

    it('parses US comma-thousands and decimal dot "1,250.50" as 1250.5', () => {
      const parsed = service.parseWithHeuristics('Factura proveedor USD 1,250.50', 90);
      expect(parsed.amount).toBe(1250.5);
      expect(parsed.currency).toBe('USD');
      expect(parsed.scope).toBe('business');
      expect(parsed.expenseCategory).toBe('provider_merchandise');
    });

    it('parses integer USD amount "$25" and suffix "25$" as 25 instead of 0', () => {
      const parsedPrefix = service.parseWithHeuristics('Pago gasolina $25', 90);
      expect(parsedPrefix.amount).toBe(25);
      expect(parsedPrefix.currency).toBe('USD');
      expect(parsedPrefix.expenseCategory).toBe('transport');

      const parsedSuffix = service.parseWithHeuristics('Pago gasolina 25$ hoy', 90);
      expect(parsedSuffix.amount).toBe(25);
      expect(parsedSuffix.currency).toBe('USD');
    });

    it('parses Venezuelan format "Bs 1.500,50" as 1500.5', () => {
      const parsed = service.parseWithHeuristics('Pago Movil supermercado Bs 1.500,50', 90);
      expect(parsed.amount).toBe(1500.5);
      expect(parsed.currency).toBe('VES');
      expect(parsed.expenseCategory).toBe('groceries');
    });

    it('parses Venezuelan thousands without decimals "Bs 1.500" as 1500', () => {
      const parsed = service.parseWithHeuristics('Total Bs 1.500', 90);
      expect(parsed.amount).toBe(1500);
      expect(parsed.currency).toBe('VES');
    });

    it('parses Spanish comma decimal "12,50" as 12.5', () => {
      const parsed = service.parseWithHeuristics('Total 12,50', 90);
      expect(parsed.amount).toBe(12.5);
    });

    it('detects Cashea installment number and reference number without confusing them with amount', () => {
      const parsed = service.parseWithHeuristics(
        'Cashea Cuota 2 de 3 - Total pagado $18.75 - Referencia: 998877',
        91,
      );
      expect(parsed.isCashea).toBe(true);
      expect(parsed.casheaInstallmentNumber).toBe(2);
      expect(parsed.amount).toBe(18.75);
      expect(parsed.currency).toBe('USD');
      expect(parsed.expenseCategory).toBe('cashea_installment');
      expect(parsed.referenceNumber).toBe('998877');
    });

    it('does not capture non-reference words from "Comprobante de pago" as referenceNumber', () => {
      const parsed = service.parseWithHeuristics('Comprobante de pago mercado $25', 90);
      expect(parsed.amount).toBe(25);
      expect(parsed.referenceNumber).toBeUndefined();
    });
  });
});
