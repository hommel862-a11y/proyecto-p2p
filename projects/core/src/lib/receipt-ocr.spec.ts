import { describe, it, expect } from 'vitest';
import {
  parseBankReceiptText,
  detectBankType,
  parseReceiptAmount,
  extractReference,
  exportReceiptsToCSV,
} from './receipt-ocr';

describe('Receipt OCR Parser Domain Engine', () => {
  describe('parseReceiptAmount', () => {
    it('parses Latin format with thousand dot and decimal comma', () => {
      expect(parseReceiptAmount('1.250,50 Bs.')).toBe(1250.5);
      expect(parseReceiptAmount('Bs. 45.890,25')).toBe(45890.25);
    });

    it('parses standard US format', () => {
      expect(parseReceiptAmount('$ 1,250.50')).toBe(1250.5);
      expect(parseReceiptAmount('$85.00 USD')).toBe(85.0);
    });

    it('handles clean integers or single separators', () => {
      expect(parseReceiptAmount('500,00')).toBe(500.0);
      expect(parseReceiptAmount('500.00')).toBe(500.0);
      expect(parseReceiptAmount('150000')).toBe(150000);
    });
  });

  describe('detectBankType', () => {
    it('detects Venezuelan banks correctly', () => {
      expect(detectBankType('Pago Móvil BDV en línea exitoso')).toBe('BDV');
      expect(detectBankType('Banco de Venezuela comprobante')).toBe('BDV');
      expect(detectBankType('Transferencia Banesco Online')).toBe('BANESCO');
      expect(detectBankType('Mercantil Móvil recibo')).toBe('MERCANTIL');
      expect(detectBankType('BBVA Provincial')).toBe('PROVINCIAL');
      expect(detectBankType('Bancamiga pago')).toBe('BANCAMIGA');
    });

    it('detects regional and wallet providers', () => {
      expect(detectBankType('Comprobante Bancolombia')).toBe('BANCOLOMBIA');
      expect(detectBankType('Nequi ¡Enviaste plata!')).toBe('NEQUI');
      expect(detectBankType('Zinli send money receipt')).toBe('ZINLI');
      expect(detectBankType('El Dorado P2P order')).toBe('EL_DORADO');
    });
  });

  describe('parseBankReceiptText', () => {
    it('parses a BDV Pago Móvil receipt with cédula and reference', () => {
      const bdvText = `
        BDV en línea
        Comprobante de Pago Móvil
        Operación Exitosa
        Referencia: 0009842145
        Monto: Bs. 4.250,50
        Teléfono destino: 0414-1234567
        Beneficiario: JUAN PEREZ
        Cédula: V-18920194
        Fecha: 10/09/2026 14:30:00
      `;

      const result = parseBankReceiptText(bdvText);
      expect(result.bank).toBe('BDV');
      expect(result.reference).toBe('0009842145');
      expect(result.amount).toBe(4250.5);
      expect(result.currency).toBe('VES');
      expect(result.payerId).toBe('V-18920194');
      expect(result.beneficiaryPhone).toBe('04141234567');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.8);
      expect(result.isDuplicate).toBe(false);
    });

    it('parses Banesco receipt text and identifies pagador', () => {
      const banescoText = `
        Banesco Banco Universal
        Recibo de Transferencia
        Nro. de Referencia: 84920194
        Monto: 3.500,00 Bs.
        Pagador: CARLOS GOMEZ
        Concepto: Compra P2P
        Fecha: 10/09/2026
      `;

      const result = parseBankReceiptText(banescoText);
      expect(result.bank).toBe('BANESCO');
      expect(result.reference).toBe('84920194');
      expect(result.amount).toBe(3500.0);
      expect(result.payerName).toBe('CARLOS GOMEZ');
    });

    it('parses Bancolombia / Nequi COP receipt', () => {
      const nequiText = `
        Nequi
        ¡Enviaste plata!
        ¿Cuánto? $ 150.000,00
        Comprobante: M9482014
        Para: 3001234567
        Fecha: 10 sep 2026
      `;

      const result = parseBankReceiptText(nequiText);
      expect(result.bank).toBe('NEQUI');
      expect(result.currency).toBe('COP');
      expect(result.amount).toBe(150000.0);
      expect(result.reference).toBe('M9482014');
    });

    it('parses Zinli USD wallet transfer', () => {
      const zinliText = `
        Zinli
        Transfer Completed
        Transaction ID: ZIN-849201
        Amount: $ 120.50 USD
        Recipient: merchant@crypto.com
        Date: 2026-09-10
      `;

      const result = parseBankReceiptText(zinliText);
      expect(result.bank).toBe('ZINLI');
      expect(result.currency).toBe('USD');
      expect(result.amount).toBe(120.5);
      expect(result.reference).toBe('ZIN-849201');
    });

    it('triggers anti-triangulation alert when payer name mismatches verified counterparty', () => {
      const receiptText = `
        Banesco
        Referencia: 94820192
        Monto: Bs. 1.000,00
        Pagador: PEDRO TERCERO
      `;

      const result = parseBankReceiptText(receiptText, {
        expectedCounterpartyName: 'Carlos BinanceMerchant',
      });

      expect(result.antiTriangulationAlert).toBe(true);
      expect(result.antiTriangulationReason).toContain('ALERTA DE SEGURIDAD');
    });

    it('flags duplicate references when already in ledger', () => {
      const receiptText = `
        BDV Pago Móvil
        Referencia: 99887766
        Monto: Bs. 500,00
      `;

      const result = parseBankReceiptText(receiptText, {
        knownReferences: ['99887766', '11223344'],
      });

      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('exportReceiptsToCSV', () => {
    it('generates Excel-compatible UTF-8 BOM CSV string', () => {
      const sample = parseBankReceiptText(`
        BDV Pago Móvil
        Referencia: 12345678
        Monto: Bs. 1.500,00
      `);

      const csv = exportReceiptsToCSV([sample]);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('ID Registro;Banco;Referencia;Monto;Moneda');
      expect(csv).toContain('12345678');
      expect(csv).toContain('1500.00');
      expect(csv).toContain('Banco de Venezuela');
    });
  });
});
