import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { VoiceDictationService } from './voice-dictation.service';
import { StorageService } from './storage';
import { ToastService } from './toast.service';
import { SecureVaultService } from './secure-vault.service';

describe('VoiceDictationService', () => {
  let service: VoiceDictationService;
  let mockStorage: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let mockVault: {
    getSecret: ReturnType<typeof vi.fn>;
  };
  let mockToast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };
  let originalElectron: unknown;

  beforeEach(() => {
    originalElectron = (window as unknown as { electron?: unknown }).electron;
    delete (window as unknown as { electron?: unknown }).electron;

    mockStorage = {
      get: vi.fn().mockReturnValue('legacy-plaintext-key-must-be-ignored'),
      set: vi.fn(),
    };

    mockVault = {
      getSecret: vi.fn().mockResolvedValue(null),
    };

    mockToast = {
      success: vi.fn().mockReturnValue('toast-id'),
      error: vi.fn().mockReturnValue('toast-id'),
      warn: vi.fn().mockReturnValue('toast-id'),
      info: vi.fn().mockReturnValue('toast-id'),
    };

    TestBed.configureTestingModule({
      providers: [
        VoiceDictationService,
        { provide: StorageService, useValue: mockStorage },
        { provide: SecureVaultService, useValue: mockVault },
        { provide: ToastService, useValue: mockToast },
      ],
    });

    service = TestBed.inject(VoiceDictationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalElectron !== undefined) {
      (window as unknown as { electron?: unknown }).electron = originalElectron;
    } else {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });

  describe('parseP2pCommand', () => {
    it('correctly parses a complete P2P sell command with colloquial Venezuelan phrasing', () => {
      const transcript =
        'Venta de 250 USDT a tasa 78 con 60 por Banesco referencia 849312 cédula 18940211';
      const parsed = service.parseP2pCommand(transcript);

      expect(parsed.type).toBe('sell');
      expect(parsed.pair).toBe('USDT');
      expect(parsed.usdtAmount).toBe(250);
      expect(parsed.price).toBe(78.6);
      expect(parsed.bankCode).toBe('BANESCO');
      expect(parsed.reference).toBe('849312');
      expect(parsed.documentId).toBe('V-18940211');
      expect(parsed.summaryBadges).toContain('🔴 VENTA');
      expect(parsed.summaryBadges).toContain('🪙 USDT');
      expect(parsed.summaryBadges).toContain('🏦 Banesco');
    });

    it('correctly parses a P2P buy command with decimal comma and Mercantil bank', () => {
      const transcript = 'Compra de 100 USDT a 79,25 por Mercantil ref 554120';
      const parsed = service.parseP2pCommand(transcript);

      expect(parsed.type).toBe('buy');
      expect(parsed.usdtAmount).toBe(100);
      expect(parsed.price).toBe(79.25);
      expect(parsed.bankCode).toBe('MERCANTIL');
      expect(parsed.reference).toBe('554120');
      expect(parsed.summaryBadges).toContain('🟢 COMPRA');
      expect(parsed.summaryBadges).toContain('🏦 Mercantil');
    });

    it('detects EUR pair when mentioned', () => {
      const transcript = 'Vendí 50 euros a 85 por BDV ref 112233';
      const parsed = service.parseP2pCommand(transcript);

      expect(parsed.type).toBe('sell');
      expect(parsed.pair).toBe('EUR');
      expect(parsed.usdtAmount).toBe(50);
      expect(parsed.price).toBe(85);
      expect(parsed.bankCode).toBe('BDV');
      expect(parsed.reference).toBe('112233');
    });
  });

  describe('parseFinance360Command', () => {
    it('correctly parses an expense command with categories, reference and Pago Móvil', () => {
      const transcript =
        'Gasté 35 dólares en repuestos del taller por Pago Móvil Banesco referencia 774120';
      const parsed = service.parseFinance360Command(transcript, 60);

      expect(parsed.pillar).toBe('expense');
      expect(parsed.amount).toBe(35);
      expect(parsed.currency).toBe('USD');
      expect(parsed.expenseCategory).toBe('provider_merchandise');
      expect(parsed.vaultHint).toBe('bs_bank');
      expect(parsed.referenceNumber).toBe('774120');
      expect(parsed.summaryBadges).toContain('🔴 GASTO');
    });

    it('correctly parses an income command with Zelle vault hint', () => {
      const transcript = 'Cobré 500 dólares de sueldo por Zelle';
      const parsed = service.parseFinance360Command(transcript, 60);

      expect(parsed.pillar).toBe('income');
      expect(parsed.amount).toBe(500);
      expect(parsed.currency).toBe('USD');
      expect(parsed.incomeCategory).toBe('salary');
      expect(parsed.vaultHint).toBe('zelle');
      expect(parsed.summaryBadges).toContain('🟢 INGRESO');
      expect(parsed.summaryBadges).toContain('💳 Zelle');
    });

    it('classifies "Pagué el sueldo al ayudante 50 dólares" as expense (payroll), NOT income', () => {
      const parsed = service.parseFinance360Command('Pagué el sueldo al ayudante 50 dólares', 90);

      expect(parsed.pillar).toBe('expense');
      expect(parsed.expenseCategory).toBe('payroll');
      expect(parsed.scope).toBe('business');
      expect(parsed.amount).toBe(50);
      expect(parsed.currency).toBe('USD');
    });

    it('classifies "Pagué nómina 120 USD" as expense (payroll)', () => {
      const parsed = service.parseFinance360Command('Pagué nómina 120 USD', 90);

      expect(parsed.pillar).toBe('expense');
      expect(parsed.expenseCategory).toBe('payroll');
      expect(parsed.scope).toBe('business');
      expect(parsed.amount).toBe(120);
      expect(parsed.currency).toBe('USD');
    });

    it('classifies standalone "Sueldo 450 dólares" and "Me pagaron el sueldo 300 USD" as income', () => {
      const standalone = service.parseFinance360Command('Sueldo 450 dólares', 90);
      expect(standalone.pillar).toBe('income');
      expect(standalone.incomeCategory).toBe('salary');
      expect(standalone.amount).toBe(450);

      const paidToMe = service.parseFinance360Command('Me pagaron el sueldo 300 USD', 90);
      expect(paidToMe.pillar).toBe('income');
      expect(paidToMe.incomeCategory).toBe('salary');
      expect(paidToMe.amount).toBe(300);
    });

    it('parses Venezuelan thousands separator "1.500 bolívares" as 1500 and "12.50 dólares" as 12.5', () => {
      const vesParsed = service.parseFinance360Command('Gasté 1.500 bolívares en mercado', 90);
      expect(vesParsed.amount).toBe(1500);
      expect(vesParsed.currency).toBe('VES');
      expect(vesParsed.expenseCategory).toBe('groceries');

      const vesDecParsed = service.parseFinance360Command(
        'Gasté 1.500,50 bolívares en gasolina',
        90,
      );
      expect(vesDecParsed.amount).toBe(1500.5);
      expect(vesDecParsed.currency).toBe('VES');

      const usdParsed = service.parseFinance360Command('Gasté 12.50 dólares en farmacia', 90);
      expect(usdParsed.amount).toBe(12.5);
      expect(usdParsed.currency).toBe('USD');
    });
  });

  describe('Security hardening: no silent fake-expense trap and proxy/vault priority', () => {
    it('returns explicit error status when audio is too short without fabricating an expense', async () => {
      const result = await service.transcribeAudio('c2hvcnQ=', 'audio/webm');

      expect(result.status).toBe('error');
      expect(result.transcript).toBeUndefined();
      expect(service.status()).toBe('error');
      expect(mockToast.warn).toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('returns no_api_key when SecureVault has no Gemini key and never reads plaintext StorageService', async () => {
      const longBase64 = 'A'.repeat(600);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.transcribeAudio(longBase64, 'audio/webm');

      expect(result.status).toBe('no_api_key');
      expect(service.status()).toBe('no_api_key');
      expect(mockVault.getSecret).toHaveBeenCalledWith('gemini_api_key');
      expect(mockStorage.get).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockToast.warn).toHaveBeenCalled();
    });

    it('prefers window.electron.copilot.transcribeAudio over direct fetch', async () => {
      const longBase64 = 'B'.repeat(600);
      const transcribeAudio = vi.fn().mockResolvedValue({ text: 'Gasté 20 dólares en gasolina' });
      (window as unknown as { electron: unknown }).electron = {
        copilot: { transcribeAudio },
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.transcribeAudio(longBase64, 'audio/webm;codecs=opus');

      expect(result.status).toBe('ok');
      expect(result.transcript).toBe('Gasté 20 dólares en gasolina');
      expect(transcribeAudio).toHaveBeenCalledWith({
        audioBase64: longBase64,
        mimeType: 'audio/webm',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockVault.getSecret).not.toHaveBeenCalled();
    });

    it('falls back to window.electron.finance360.aiAnalyze when copilot.transcribeAudio is absent', async () => {
      const longBase64 = 'C'.repeat(600);
      const aiAnalyze = vi
        .fn()
        .mockResolvedValue({ success: true, text: 'Pagué nómina 120 USD' });
      (window as unknown as { electron: unknown }).electron = {
        finance360: { aiAnalyze },
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await service.transcribeAudio(longBase64, 'audio/webm');

      expect(result.status).toBe('ok');
      expect(result.transcript).toBe('Pagué nómina 120 USD');
      expect(aiAnalyze).toHaveBeenCalledWith(
        expect.objectContaining({
          inlineData: { mimeType: 'audio/webm', data: longBase64 },
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns explicit error status when Gemini API fails instead of fabricating an expense', async () => {
      const longBase64 = 'D'.repeat(600);
      mockVault.getSecret.mockResolvedValue('vault-gemini-key');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await service.transcribeAudio(longBase64, 'audio/webm');

      expect(result.status).toBe('error');
      expect(result.transcript).toBeUndefined();
      expect(service.status()).toBe('error');
      expect(mockToast.warn).toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('never invokes onFinalTranscript with a fabricated phrase when microphone is unavailable', async () => {
      const callback = vi.fn();
      const startResult = await service.startListening(
        'finance360',
        callback,
        'Gasté 35 dólares en repuestos del taller',
      );

      expect(startResult.status).toBe('error');
      expect(service.isListening()).toBe(false);
      expect(service.status()).toBe('error');
      expect(callback).not.toHaveBeenCalled();
      expect(mockToast.warn).toHaveBeenCalled();
    });
  });

  describe('Recording state transitions', () => {
    it('starts listening with isListening signal being reactive when MediaRecorder is available', async () => {
      const stopTrack = vi.fn();
      const fakeStream = {
        getTracks: () => [{ stop: stopTrack }],
      } as unknown as MediaStream;

      const originalMediaDevices = navigator.mediaDevices;
      const originalMediaRecorder = globalThis.MediaRecorder;

      class MockMediaRecorder {
        static isTypeSupported = () => true;
        state: 'inactive' | 'recording' = 'inactive';
        ondataavailable: ((ev: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start(): void {
          this.state = 'recording';
        }
        stop(): void {
          this.state = 'inactive';
        }
      }

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
      });
      (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MockMediaRecorder;

      try {
        expect(service.isListening()).toBe(false);

        const callback = vi.fn();
        await service.startListening('p2p', callback);

        expect(service.isRecording()).toBe(true);
        expect(service.isListening()).toBe(true);
        expect(service.activeContext()).toBe('p2p');

        service.stopListening();
        expect(service.isRecording()).toBe(false);
      } finally {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: originalMediaDevices,
        });
        (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = originalMediaRecorder;
      }
    });
  });
});
