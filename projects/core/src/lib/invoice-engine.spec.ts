import { describe, it, expect } from 'vitest';
import {
  parseBinanceP2pCsv,
  generateInvoicesFromTransactions,
  generateInvoicesFromAppOperations,
  sanitizeComplianceText,
  classifyTicketTier,
  type IssuerProfile,
  COMPLIANT_SERVICE_CONCEPTS,
} from './invoice-engine';
import { type Operation } from './log';

describe('InvoiceEngine Domain Logic', () => {
  const dummyIssuer: IssuerProfile = {
    businessName: 'Consultores Digitales Alpha C.A.',
    taxId: 'J-12345678-9',
    address: 'Av. Francisco de Miranda, Caracas, Venezuela',
    email: 'contacto@alpha.com',
  };

  it('sanitizes forbidden crypto and P2P keywords', () => {
    const raw = 'Pago de orden USDT p2p binance arbitraje de crypto bitcoin';
    const clean = sanitizeComplianceText(raw);
    expect(clean.toLowerCase()).not.toContain('usdt');
    expect(clean.toLowerCase()).not.toContain('binance');
    expect(clean.toLowerCase()).not.toContain('crypto');
    expect(clean.toLowerCase()).not.toContain('bitcoin');
    expect(clean.toLowerCase()).not.toContain('arbitraje');
  });

  it('classifies ticket tiers properly', () => {
    expect(classifyTicketTier(50, 'USD')).toBe('LOW');
    expect(classifyTicketTier(150, 'USD')).toBe('MID');
    expect(classifyTicketTier(800, 'USD')).toBe('HIGH');
  });

  it('parses Binance CSV in Spanish format correctly', () => {
    const csv = `Fecha/Hora,Tipo,Par,Cantidad,Tasa Bs,Total Bs,Banco,Contraparte,Tiempo Liberacion (min),Spread vs BCV,Clasificacion,Estado,Notas
2026-08-29 16:41,VENTA,EUR,100.00,900.00,"90,000.00",Banesco,@TraderDemo,5,20.00%,EXCELENTE,COMPLETADA,Ciclo automatico
2026-08-29 17:00,COMPRA,USDT,50.00,890.00,"44,500.00",Pago Movil,@VendedorTest,3,1.5%,BUENA,COMPLETADA,Fondos propios`;

    const parsed = parseBinanceP2pCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('SELL');
    expect(parsed[0].counterparty).toBe('TraderDemo');
    expect(parsed[0].fiatAmount).toBe(90000);
    expect(parsed[1].type).toBe('BUY');
    expect(parsed[1].counterparty).toBe('VendedorTest');
  });

  it('generates invoices only for SELL transactions with sequential numbering', () => {
    const csv = `Fecha/Hora,Tipo,Par,Cantidad,Tasa Bs,Total Bs,Banco,Contraparte,Estado
2026-09-01 10:00,VENTA,USDT,100.00,90.00,"9000.00",Banesco,@ClienteUno,COMPLETADA
2026-09-01 11:00,COMPRA,USDT,200.00,89.00,"17800.00",Banesco,@ClienteDos,COMPLETADA
2026-09-01 12:00,VENTA,USDT,150.00,90.50,"13575.00",Mercantil,@ClienteTres,COMPLETADA`;

    const parsed = parseBinanceP2pCsv(csv);
    const invoices = generateInvoicesFromTransactions(parsed, dummyIssuer, {
      invoicePrefix: 'FAC',
      startNumber: 101,
      defaultTaxRatePct: 0,
    });

    expect(invoices).toHaveLength(2); // Only 2 SELL orders
    expect(invoices[0].invoiceNumber).toContain('FAC-2026-0101');
    expect(invoices[1].invoiceNumber).toContain('FAC-2026-0102');
    expect(invoices[0].client.name).toBe('ClienteUno');
    expect(invoices[1].client.name).toBe('ClienteTres');
    expect(invoices[0].total).toBe(9000);
    expect(invoices[1].total).toBe(13575);
    expect(invoices[0].items[0].description).toBeDefined();
    expect(invoices[0].notes).not.toContain('crypto');
  });

  it('generates invoices from app operations correctly', () => {
    const ops: Operation[] = [
      {
        id: 'op-1',
        type: 'sell',
        pair: 'USDT',
        usdtAmount: 100,
        price: 85,
        vesAmount: 8500,
        fees: 21.25,
        merchantNote: 'Juan Perez',
        notes: '',
        errorFree: true,
        bankAccountId: 'banesco-1',
        timestamp: '2026-09-15T14:30:00.000Z',
      },
      {
        id: 'op-2',
        type: 'buy',
        pair: 'USDT',
        usdtAmount: 50,
        price: 84,
        vesAmount: 4200,
        fees: 10.5,
        merchantNote: '',
        notes: '',
        errorFree: true,
        timestamp: '2026-09-15T15:00:00.000Z',
      },
    ];

    const invoices = generateInvoicesFromAppOperations(ops, dummyIssuer, {
      invoicePrefix: 'INV',
      startNumber: 500,
    });

    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toContain('INV-2026-0500');
    expect(invoices[0].subtotal).toBe(8500);
    expect(invoices[0].total).toBe(8500);
    expect(invoices[0].issuer.businessName).toBe(dummyIssuer.businessName);
  });
});
