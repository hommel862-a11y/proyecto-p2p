import { describe, it, expect } from 'vitest';
import {
  generateInvoicePdf,
  createZipArchive,
  generateInvoiceBatchZip,
} from './pdf-invoice-generator';
import { type GeneratedInvoice } from './invoice-engine';

describe('PdfInvoiceGenerator & ZipPackager', () => {
  const sampleInvoice: GeneratedInvoice = {
    invoiceNumber: 'FAC-2026-1001',
    issueDate: '2026-09-20',
    dueDate: '2026-09-27',
    issuer: {
      businessName: 'Consultores Alpha C.A.',
      taxId: 'J-12345678-9',
      address: 'Caracas, Venezuela',
    },
    client: {
      name: 'Comercializadora Beta',
      country: 'VE',
    },
    conceptCategory: 'Marketing & Publicidad',
    items: [
      {
        description: 'Consultoría en Estrategia de Marketing Digital',
        quantity: 1,
        unitPrice: 150.0,
        total: 150.0,
      },
    ],
    subtotal: 150.0,
    taxRatePct: 0,
    taxAmount: 0,
    total: 150.0,
    currency: 'USD',
    ticketTier: 'MID',
    referenceCode: 'REF-BAN-1001',
    notes: 'Comprobante de honorarios profesionales.',
  };

  it('generates a valid standards-compliant PDF 1.4 byte array', () => {
    const pdfBytes = generateInvoicePdf(sampleInvoice);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(500);

    const pdfString = new TextDecoder('utf-8').decode(pdfBytes);
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString.trim().endsWith('%%EOF')).toBe(true);
    expect(pdfString).toContain('FAC-2026-1001');
    expect(pdfString).toContain('Consultores Alpha');
  });

  it('creates a valid standard ZIP archive from file byte inputs', () => {
    const file1 = new TextEncoder().encode('Hello World 1');
    const file2 = new TextEncoder().encode('Hello World 2');

    const zipBytes = createZipArchive([
      { name: 'test1.txt', data: file1 },
      { name: 'test2.txt', data: file2 },
    ]);

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(100);

    // Check PK\x03\x04 signature at start
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);

    // Check PK\x05\x06 signature near end (EOCD record is 22 bytes)
    const eocdIndex = zipBytes.length - 22;
    expect(zipBytes[eocdIndex]).toBe(0x50); // 'P'
    expect(zipBytes[eocdIndex + 1]).toBe(0x4b); // 'K'
    expect(zipBytes[eocdIndex + 2]).toBe(0x05);
    expect(zipBytes[eocdIndex + 3]).toBe(0x06);
  });

  it('generates a batch zip archive containing multiple PDF invoices', () => {
    const inv2 = { ...sampleInvoice, invoiceNumber: 'FAC-2026-1002' };
    const zipBytes = generateInvoiceBatchZip([sampleInvoice, inv2]);

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(2000);

    // Verify first header has PK
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
  });
});
