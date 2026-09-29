import { describe, it, expect } from 'vitest';
import {
  parseCustomerChatMessage,
  generateConciergeReply,
} from './omnichannel-concierge';

describe('OmnichannelConcierge Engine', () => {
  it('parses customer request for 250 USDT via Banesco Pago Móvil', () => {
    const raw = 'Hola buenas tardes, cuánto me das por 250 usdt a pago móvil banesco?';
    const parsed = parseCustomerChatMessage(raw);

    expect(parsed.intent).toBe('QUOTE_REQUEST');
    expect(parsed.detectedAmount).toBe(250);
    expect(parsed.detectedBankRail).toBe('Pago Móvil');
    expect(parsed.operationType).toBe('SELL_CRYPTO');
  });

  it('generates a professional quote message with 15-minute timer', () => {
    const parsed = parseCustomerChatMessage('cuanto por 500 usdt?');
    const reply = generateConciergeReply(parsed, {
      deskRatePerUsd: 85.5,
      bankName: 'Banesco',
      bankAccountDetails: 'Banesco Cta: 0134-xxxx\nPago Movil: 0414-xxx V-12345678',
    });

    expect(reply.quoteAmountCrypto).toBe(500);
    expect(reply.quoteAmountFiat).toBe(42750);
    expect(reply.formattedReplyMessage).toContain('COTIZACIÓN OFICIAL');
    expect(reply.formattedReplyMessage).toContain('Cotización válida por 15 min');
  });

  it('recognizes payment proof submissions and flags for human operator review', () => {
    const parsed = parseCustomerChatMessage('listo hermano aqui te dejo el capture del pago');
    expect(parsed.intent).toBe('PAYMENT_PROOF_SENT');

    const reply = generateConciergeReply(parsed, {
      deskRatePerUsd: 85.5,
      bankName: 'Mercantil',
      bankAccountDetails: 'Mercantil Cta: 0105-xxxx',
    });

    expect(reply.requiresOperatorHumanReview).toBe(true);
    expect(reply.formattedReplyMessage).toContain('Comprobante recibido con éxito');
  });
});
