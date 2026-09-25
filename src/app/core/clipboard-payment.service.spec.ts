import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  ClipboardPaymentService,
  type ClipboardPaymentPayload,
} from './clipboard-payment.service';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';

describe('ClipboardPaymentService', () => {
  let service: ClipboardPaymentService;
  let router: Router;
  let toast: ToastService;
  let audit: AuditLoggerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ClipboardPaymentService);
    router = TestBed.inject(Router);
    toast = TestBed.inject(ToastService);
    audit = TestBed.inject(AuditLoggerService);
  });

  afterEach(() => {
    service.destroy();
  });

  it('should be created with initial state', () => {
    expect(service).toBeTruthy();
    expect(service.detectedPayment()).toBeNull();
    expect(service.isWatcherEnabled()).toBe(true);
  });

  it('handles onPaymentDetected, updates signals, logs audit and toast', () => {
    const payload: ClipboardPaymentPayload = {
      bank: 'BANESCO',
      bankDisplayName: 'Banesco Banco Universal',
      reference: '984721',
      amount: 1500,
      currency: 'VES',
      payerName: 'Maria Perez',
      payerId: 'V-20123456',
      timestamp: Date.now(),
      rawText: 'Pago movil recibido',
      confidenceScore: 0.95,
      isBlacklisted: false,
    };

    service.onPaymentDetected(payload);

    expect(service.detectedPayment()).toEqual(payload);
    expect(audit.events().length).toBeGreaterThan(0);
  });

  it('triggers security warning toast when payment is blacklisted', () => {
    const payload: ClipboardPaymentPayload = {
      bank: 'BDV',
      bankDisplayName: 'Banco de Venezuela',
      reference: '123456',
      amount: 5000,
      currency: 'VES',
      payerName: 'Sospechoso Triangulador',
      payerId: 'V-99999999',
      timestamp: Date.now(),
      rawText: 'Pago movil recibido',
      confidenceScore: 0.9,
      isBlacklisted: true,
      blacklistReason: 'Triangulación confirmada',
    };

    service.onPaymentDetected(payload);

    expect(service.detectedPayment()?.isBlacklisted).toBe(true);
    expect(toast.toasts().some((t) => t.type === 'error')).toBe(true);
  });

  it('dismisses payment signal', () => {
    service.detectedPayment.set({
      bank: 'BANESCO',
      bankDisplayName: 'Banesco',
      reference: '111111',
      amount: 100,
      currency: 'VES',
      timestamp: Date.now(),
      rawText: 'test',
      confidenceScore: 1,
    });

    service.dismiss();
    expect(service.detectedPayment()).toBeNull();
  });

  it('navigates to /log with query params and dismisses when loading into operations', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const payload: ClipboardPaymentPayload = {
      bank: 'BANESCO',
      bankDisplayName: 'Banesco Banco Universal',
      reference: '984721',
      amount: 1500,
      currency: 'VES',
      payerName: 'Carlos Gomez',
      payerId: 'V-15000000',
      timestamp: Date.now(),
      rawText: 'test',
      confidenceScore: 1,
    };

    service.detectedPayment.set(payload);
    service.loadIntoOperations(payload);

    expect(service.detectedPayment()).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/log'], {
      queryParams: {
        autoFillAmount: 1500,
        autoFillRef: '984721',
        autoFillBank: 'Banesco Banco Universal',
        autoFillPayer: 'Carlos Gomez',
        autoFillPayerId: 'V-15000000',
      },
    });
  });

  it('processes raw Venezuelan payment text correctly', () => {
    const rawText =
      'Banesco: Recibiste Pago Movil por Bs. 2.450,00 de Juan Perez CI 18.234.567 al telf 04141234567 Ref: 981234.';
    const result = service.processRawText(rawText);

    expect(result).not.toBeNull();
    expect(result?.amount).toBe(2450);
    expect(result?.reference).toBe('981234');
    expect(service.detectedPayment()).toEqual(result);
  });

  it('ignores invalid text or short snippets in processRawText', () => {
    expect(service.processRawText('hola que tal')).toBeNull();
    expect(service.processRawText('')).toBeNull();
  });
});
