import { TestBed } from '@angular/core/testing';
import { VoiceDictationService } from './voice-dictation.service';
import { StorageService } from './storage';
import { ToastService } from './toast.service';

describe('VoiceDictationService', () => {
  let service: VoiceDictationService;
  let mockStorage: Partial<StorageService>;
  let mockToast: Partial<ToastService>;

  beforeEach(() => {
    mockStorage = {
      get: () => null,
      set: () => {},
    };

    mockToast = {
      success: () => 'toast-id',
      error: () => 'toast-id',
      warn: () => 'toast-id',
      info: () => 'toast-id',
    };

    TestBed.configureTestingModule({
      providers: [
        VoiceDictationService,
        { provide: StorageService, useValue: mockStorage },
        { provide: ToastService, useValue: mockToast },
      ],
    });

    service = TestBed.inject(VoiceDictationService);
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
  });

  describe('Recording state transitions', () => {
    it('starts listening with isListening signal being reactive', async () => {
      expect(service.isListening()).toBe(false);

      const callback = () => {};
      await service.startListening('p2p', callback, 'Venta de 100 USDT');

      expect(service.activeContext()).toBe('p2p');
      service.stopListening();
      expect(service.isListening()).toBe(false);
    });
  });
});
