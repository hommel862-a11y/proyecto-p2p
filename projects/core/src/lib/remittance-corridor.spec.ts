import { describe, it, expect } from 'vitest';
import {
  calculateRemittanceQuote,
  formatRemittanceWhatsAppMessage,
  DEFAULT_REMITTANCE_CORRIDORS,
  type RemittanceQuoteRequest,
} from './remittance-corridor';

describe('Remittance Corridor Engine', () => {
  it('should calculate quote by send amount with 4x1000 Colombian friction', () => {
    const request: RemittanceQuoteRequest = {
      corridorId: 'COP_BANCOLOMBIA_TO_VES',
      calculationMode: 'BY_SEND_AMOUNT',
      amount: 500000, // 500,000 COP
      originCryptoRate: 4200, // 4,200 COP per USDT
      destCryptoRate: 100, // 100 VES per USDT
      operatorMarginPct: 2.5, // 2.5% markup
      bankingFeePct: 0.4, // 4x1000
      bankingFixedFee: 0,
    };

    const quote = calculateRemittanceQuote(request);

    // 500,000 * 0.004 = 2,000 COP banking fee
    expect(quote.bankingFeeTotal).toBe(2000);
    // Net = 498,000 COP
    expect(quote.netOriginAmount).toBe(498000);
    // Crypto base = 498,000 / 4200 = 118.5714 USDT
    expect(quote.cryptoBaseUsdt).toBeCloseTo(118.5714, 2);
    // Operator margin = 118.5714 * 0.025 = 2.9643 USDT
    expect(quote.operatorMarginUsdt).toBeCloseTo(2.9643, 2);
    // Client USDT = 118.5714 - 2.9643 = 115.6071 USDT
    expect(quote.clientPayoutUsdt).toBeCloseTo(115.6071, 2);
    // Dest payout = 115.6071 * 100 = 11,560.71 VES
    expect(quote.destPayoutAmount).toBeCloseTo(11560.71, 1);
    // Operator profit in VES = 2.9643 * 100 = 296.43 VES
    expect(quote.operatorProfitDestFiat).toBeCloseTo(296.43, 1);
    // Effective rate = 11,560.71 / 500,000 = ~0.02312 VES / COP
    expect(quote.effectiveRate).toBeCloseTo(0.0231, 3);
  });

  it('should calculate quote by target receive amount (VES desired)', () => {
    const request: RemittanceQuoteRequest = {
      corridorId: 'USD_ZELLE_TO_VES',
      calculationMode: 'BY_RECEIVE_AMOUNT',
      amount: 10000, // Client wants exactly 10,000 VES
      originCryptoRate: 1.0, // 1 USD = 1 USDT
      destCryptoRate: 100, // 100 VES = 1 USDT
      operatorMarginPct: 3.0, // 3%
      bankingFeePct: 0,
      bankingFixedFee: 0,
    };

    const quote = calculateRemittanceQuote(request);

    // Client needs 10,000 / 100 = 100 USDT payout
    expect(quote.clientPayoutUsdt).toBeCloseTo(100.0, 2);
    // Crypto base = 100 / (1 - 0.03) = 103.0928 USDT
    expect(quote.cryptoBaseUsdt).toBeCloseTo(103.0928, 2);
    // Gross USD = 103.0928 USD
    expect(quote.grossOriginAmount).toBeCloseTo(103.09, 1);
    expect(quote.destPayoutAmount).toBe(10000);
  });

  it('should format a professional WhatsApp message with all key fields', () => {
    const request: RemittanceQuoteRequest = {
      corridorId: 'COP_BANCOLOMBIA_TO_VES',
      calculationMode: 'BY_SEND_AMOUNT',
      amount: 1000000,
      originCryptoRate: 4200,
      destCryptoRate: 100,
      operatorMarginPct: 2.0,
    };

    const quote = calculateRemittanceQuote(request);
    const msg = formatRemittanceWhatsAppMessage(quote, {
      companyOrDeskName: 'Caracas Trading Desk',
      validityMinutes: 20,
    });

    expect(msg).toContain('Caracas Trading Desk');
    expect(msg).toContain('Bancolombia');
    expect(msg).toContain('Pago Móvil');
    expect(msg).toContain('1.000.000,00 COP');
    expect(msg).toContain('20 minutos');
    expect(msg).toContain('Cero pagos a través de terceros');
  });

  it('should quote Peru (PEN) -> VES by send amount', () => {
    const quote = calculateRemittanceQuote({
      corridorId: 'PEN_YAPE_TO_VES',
      calculationMode: 'BY_SEND_AMOUNT',
      amount: 375, // 375 PEN
      originCryptoRate: 3.75, // 100 USDT
      destCryptoRate: 100,
      operatorMarginPct: 3.0,
    });

    expect(quote.originCurrency).toBe('PEN');
    expect(quote.destCurrency).toBe('VES');
    expect(quote.bankingFeeTotal).toBe(0);
    expect(quote.cryptoBaseUsdt).toBeCloseTo(100, 4);
    expect(quote.clientPayoutUsdt).toBeCloseTo(97, 4);
    expect(quote.destPayoutAmount).toBeCloseTo(9700, 2);
  });

  it('should quote Venezuela (VES) -> Peru (PEN) with PEN payout', () => {
    const quote = calculateRemittanceQuote({
      corridorId: 'VES_TO_PEN_YAPE',
      calculationMode: 'BY_SEND_AMOUNT',
      amount: 10000, // 10,000 VES
      originCryptoRate: 100, // 100 USDT
      destCryptoRate: 3.75,
      operatorMarginPct: 3.0,
    });

    expect(quote.originCurrency).toBe('VES');
    expect(quote.destCurrency).toBe('PEN');
    expect(quote.destPaymentMethod).toContain('Yape');
    expect(quote.destPayoutAmount).toBeCloseTo(363.75, 2); // 97 USDT * 3.75

    const msg = formatRemittanceWhatsAppMessage(quote);
    // Tiny VES->PEN rate is shown inverted: 1 PEN = 27.49 VES
    expect(msg).toContain('1 PEN = 27.49 VES');
    expect(msg).toContain('PEN');
  });

  it('should solve VES -> PEN by target PEN amount', () => {
    const quote = calculateRemittanceQuote({
      corridorId: 'VES_TO_PEN_YAPE',
      calculationMode: 'BY_RECEIVE_AMOUNT',
      amount: 375, // client must receive 375 PEN = 100 USDT
      originCryptoRate: 100,
      destCryptoRate: 3.75,
      operatorMarginPct: 0,
    });

    expect(quote.destPayoutAmount).toBe(375);
    expect(quote.grossOriginAmount).toBeCloseTo(10000, 2);
  });

  it('should expose every corridor with a unique id', () => {
    const ids = DEFAULT_REMITTANCE_CORRIDORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('PEN_YAPE_TO_VES');
    expect(ids).toContain('VES_TO_PEN_YAPE');
  });
});
