import { describe, it, expect } from 'vitest';
import {
  parseBankReceiptText,
  detectBankType,
  parseReceiptAmount,
  extractReference,
  exportReceiptsToCSV,
  sanitizeCsvCell,
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

    it('detects extended international banks, wallets and C2P with proper precedence', () => {
      expect(detectBankType('Banesco Panamá Transferencia Internacional')).toBe('BANESCO_PANAMA');
      expect(detectBankType('Banesco Panama Online Banking')).toBe('BANESCO_PANAMA');
      expect(detectBankType('Mercantil Panamá Recibo ACH')).toBe('MERCANTIL_PANAMA');
      expect(detectBankType('Mercantil Panama Transfer')).toBe('MERCANTIL_PANAMA');
      expect(detectBankType('Pago realizado con Zelle')).toBe('ZELLE');
      expect(detectBankType('Wally Tech wallet transfer')).toBe('WALLY');
      expect(detectBankType('Binance Pay Order Completed')).toBe('BINANCE_PAY');
      expect(detectBankType('Cuota Cashea aprobada')).toBe('CASHEA');
      expect(detectBankType('Facebank International wire receipt')).toBe('FACEBANK');
      expect(detectBankType('Pago Móvil C2P confirmado')).toBe('PAGO_MOVIL_C2P');
      expect(detectBankType('Cobro con Clave de Pago exitoso')).toBe('PAGO_MOVIL_C2P');
    });
  });

  describe('extractReference', () => {
    it('extracts Zelle confirmation codes, Binance Pay Order IDs and Cashea refs', () => {
      expect(extractReference('Zelle Payment Confirmation # ZEL9847261A')).toBe('ZEL9847261A');
      expect(extractReference('Confirmación: 9K8L7M6N5')).toBe('9K8L7M6N5');
      expect(extractReference('Binance Pay Order ID: 284759102837465910')).toBe('284759102837465910');
      expect(extractReference('ID de orden: BP-94820194')).toBe('BP-94820194');
      expect(extractReference('Compra aprobada Cashea CSH-2026-849201')).toBe('CSH-2026-849201');
      expect(extractReference('Transferencia completada 284759102837465910')).toBe('284759102837465910');
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
      expect(result.payerName).toBe('JUAN PEREZ');
      expect(result.payerId).toBe('V-18920194');
      expect(result.beneficiaryPhone).toBe('04141234567');
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0.8);
      expect(result.isDuplicate).toBe(false);
    });

    it('parses BDV Pago Móvil with Nombre label and 12-digit reference', () => {
      const bdvText = `
        Comprobante de Pago Móvil BDV
        Monto: Bs. 1.000,00
        Referencia: 007736689881
        Nombre: PEDRO JOSE CASTILLO
        Cédula: V-24890123
        Fecha: 20/10/2026 17:35:10
      `;

      const result = parseBankReceiptText(bdvText);
      expect(result.bank).toBe('BDV');
      expect(result.reference).toBe('007736689881');
      expect(result.amount).toBe(1000.0);
      expect(result.payerName).toBe('PEDRO JOSE CASTILLO');
      expect(result.payerId).toBe('V-24890123');
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

    it('detects USDT, EUR, USD and extended bank receipts accurately', () => {
      const binancePay = parseBankReceiptText(`
        Binance Pay
        Payment Successful
        Order ID: 284759102837465910
        Amount: 250.00 USDT
      `);
      expect(binancePay.bank).toBe('BINANCE_PAY');
      expect(binancePay.currency).toBe('USDT');
      expect(binancePay.amount).toBe(250);
      expect(binancePay.reference).toBe('284759102837465910');

      const eurTransfer = parseBankReceiptText(`
        Facebank International
        Transferencia enviada
        Referencia: FBK9847261
        Monto: € 180,50 EUR
      `);
      expect(eurTransfer.bank).toBe('FACEBANK');
      expect(eurTransfer.currency).toBe('EUR');
      expect(eurTransfer.amount).toBe(180.5);

      const zelleReceipt = parseBankReceiptText(`
        Zelle Payment
        Confirmation # ZEL9847261A
        Amount: $ 320.00
      `);
      expect(zelleReceipt.bank).toBe('ZELLE');
      expect(zelleReceipt.currency).toBe('USD');
      expect(zelleReceipt.amount).toBe(320);
      expect(zelleReceipt.reference).toBe('ZEL9847261A');

      const casheaReceipt = parseBankReceiptText(`
        Cashea Cuota Pagada
        Comprobante: CSH-8492019
        Monto: $ 45.00
      `);
      expect(casheaReceipt.bank).toBe('CASHEA');
      expect(casheaReceipt.currency).toBe('USD');
      expect(casheaReceipt.reference).toBe('CSH-8492019');
    });
  });

  describe('sanitizeCsvCell & exportReceiptsToCSV', () => {
    it('neutralizes spreadsheet formula injection prefixes and escapes RFC 4180 quotes', () => {
      expect(sanitizeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
      expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe(`"'+SUM(A1:A2)"`);
      expect(sanitizeCsvCell('-500')).toBe(`"'-500"`);
      expect(sanitizeCsvCell('@HYPERLINK("http://x")')).toBe(`"'@HYPERLINK(""http://x"")"`);
      expect(sanitizeCsvCell('\t=1+1')).toBe(`"'\t=1+1"`);
      expect(sanitizeCsvCell('\r=1+1')).toBe(`"'\r=1+1"`);
      expect(sanitizeCsvCell('Normal "quoted" text')).toBe(`"Normal ""quoted"" text"`);
      expect(sanitizeCsvCell(null)).toBe(`""`);
    });

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

    it('sanitizes formula-injected fields inside exported CSV rows', () => {
      const malicious = {
        ...parseBankReceiptText(`
          Zelle
          Confirmation # ZEL9847261A
          Amount: $ 100.00
        `),
        payerName: '=HYPERLINK("https://evil.example","Click")',
        beneficiaryName: '+1+1',
      };

      const csv = exportReceiptsToCSV([malicious]);
      expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""Click"")"`);
      expect(csv).toContain(`"'+1+1"`);
      expect(csv).not.toContain(`"=HYPERLINK`);
    });
  });
});
