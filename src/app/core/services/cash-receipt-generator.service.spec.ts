import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  CashReceiptGeneratorService,
  type CashReceiptData,
} from './cash-receipt-generator.service';

describe('CashReceiptGeneratorService', () => {
  let service: CashReceiptGeneratorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CashReceiptGeneratorService],
    });
    service = TestBed.inject(CashReceiptGeneratorService);
  });

  it('should generate a valid receipt number format REC-YYYYMMDD-XXXX', () => {
    const num = service.generateReceiptNumber();
    expect(num).toMatch(/^REC-\d{8}-\d{4}$/);
  });

  it('should generate complete HTML containing payer, amount in USD and Bs, and signatures', () => {
    const sampleData: CashReceiptData = {
      receiptNumber: 'REC-20261015-1234',
      date: '2026-10-15',
      payerName: 'Alejandro Morales',
      payerIdDoc: 'V-19876543',
      receiverName: 'Taller San José',
      receiverIdDoc: 'J-30123456-0',
      concept: 'Anticipo 50% de latonería y pintura Corolla 2012',
      amountUsd: 150.0,
      amountVes: 9000.0,
      bcvRateApplied: 60.0,
      paymentMethod: 'Efectivo Divisas ($)',
      scope: 'business',
      businessName: 'Taller San José C.A.',
    };

    const html = service.generateReceiptHtml(sampleData);
    expect(html).toContain('REC-20261015-1234');
    expect(html).toContain('Alejandro Morales');
    expect(html).toContain('Taller San José');
    expect(html).toContain('$150.00');
    expect(html).toContain('9.000,00');
    expect(html).toContain('COMPROBANTE COMERCIAL / PYME');
    expect(html).toContain('Firma de Quien Entrega');
    expect(html).toContain('Firma de Quien Recibe Conforme');
  });
});
