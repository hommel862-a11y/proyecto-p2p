import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  CashReceiptGeneratorService,
  type CashReceiptData,
} from './cash-receipt-generator.service';

describe('CashReceiptGeneratorService', () => {
  let service: CashReceiptGeneratorService;
  let originalElectron: unknown;

  const baseReceipt: CashReceiptData = {
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

  beforeEach(() => {
    originalElectron = (window as unknown as { electron?: unknown }).electron;
    delete (window as unknown as { electron?: unknown }).electron;

    TestBed.configureTestingModule({
      providers: [CashReceiptGeneratorService],
    });
    service = TestBed.inject(CashReceiptGeneratorService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalElectron !== undefined) {
      (window as unknown as { electron?: unknown }).electron = originalElectron;
    } else {
      delete (window as unknown as { electron?: unknown }).electron;
    }
  });

  it('should generate a valid receipt number format REC-YYYYMMDD-XXXX', () => {
    const num = service.generateReceiptNumber();
    expect(num).toMatch(/^REC-\d{8}-\d{4}$/);
  });

  it('should generate complete HTML containing payer, amount in USD and Bs, and signatures', () => {
    const html = service.generateReceiptHtml(baseReceipt);
    expect(html).toContain('REC-20261015-1234');
    expect(html).toContain('Alejandro Morales');
    expect(html).toContain('Taller San José');
    expect(html).toContain('$150.00');
    expect(html).toContain('9.000,00');
    expect(html).toContain('COMPROBANTE COMERCIAL / PYME');
    expect(html).toContain('Firma de Quien Entrega');
    expect(html).toContain('Firma de Quien Recibe Conforme');
  });

  it('escapes XSS payloads in concept, payerName, businessName, notes, and all other interpolated fields', () => {
    const maliciousData: CashReceiptData = {
      ...baseReceipt,
      receiptNumber: 'REC-<script>alert(0)</script>',
      date: '2026-10-15"><svg onload=alert(9)>',
      payerName: '<img src=x onerror="alert(2)">',
      payerIdDoc: "V-123' onclick='alert(3)",
      receiverName: 'Receptor & <script>evil()</script>',
      receiverIdDoc: 'J-999`template`',
      paymentMethod: 'Zelle <img src=1 onerror=alert(4)>',
      businessName: '"><svg onload=alert(5)>Taller',
      concept: '<script>alert(1)</script> Reparación motor',
      notes: 'Nota <script>steal()</script> con `backticks`',
    };

    const html = service.generateReceiptHtml(maliciousData);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).not.toContain('<svg ');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(5)&gt;Taller');
    expect(html).toContain('&#39; onclick=&#39;alert(3)');
    expect(html).toContain('&#96;template&#96;');
    expect(html).toContain('&#96;backticks&#96;');
    expect(html).toContain('Content-Security-Policy');
  });

  it('uses Electron native exportPdf when window.electron.finance360.exportPdf is available', async () => {
    const exportPdf = vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/rec.pdf' });
    (window as unknown as { electron: unknown }).electron = {
      finance360: { exportPdf },
    };
    const openSpy = vi.spyOn(window, 'open');

    await service.printReceipt(baseReceipt);

    expect(exportPdf).toHaveBeenCalledTimes(1);
    expect(exportPdf).toHaveBeenCalledWith({
      html: expect.stringContaining('REC-20261015-1234'),
      filename: 'REC-20261015-1234.pdf',
    });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('renders into a sandboxed iframe via Blob URL in web fallback without document.write', async () => {
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://local/mock-receipt');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open');
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await service.printReceipt(baseReceipt);

    expect(openSpy).not.toHaveBeenCalled();
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const createdBlob = createObjectUrlSpy.mock.calls[0][0];
    expect(createdBlob).toBeInstanceOf(Blob);

    const appendedIframe = appendSpy.mock.calls
      .map((call) => call[0])
      .find((node): node is HTMLIFrameElement => node instanceof HTMLIFrameElement);
    expect(appendedIframe).toBeDefined();
    expect(appendedIframe?.getAttribute('sandbox')).toBe('allow-modals allow-same-origin');
    expect(appendedIframe?.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(appendedIframe?.src).toContain('blob:https://local/mock-receipt');

    // Clean up appended iframe
    appendedIframe?.remove();
    revokeObjectUrlSpy.mockRestore();
  });
});
