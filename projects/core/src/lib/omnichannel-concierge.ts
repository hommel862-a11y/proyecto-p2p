/**
 * Pure Domain Engine for Omnichannel Concierge (WhatsApp & Telegram Desk).
 * Parses unstructured customer inquiries, extracts transaction intent, amounts, and rails,
 * and generates structured conversational responses with real-time quotes and bank payment coordinates.
 * Zero external dependencies.
 */

import { roundMoney } from './money';

export type ConciergeIntent =
  | 'QUOTE_REQUEST'
  | 'PAYMENT_PROOF_SENT'
  | 'BANK_DETAILS_REQUEST'
  | 'GREETING'
  | 'UNRECOGNIZED';

export interface ConciergeParsedInquiry {
  intent: ConciergeIntent;
  detectedAmount?: number;
  detectedCurrency?: string; // e.g. "USDT", "USD", "VES"
  detectedBankRail?: string; // e.g. "Banesco", "Pago Móvil", "Mercantil", "Zelle"
  operationType: 'BUY_CRYPTO' | 'SELL_CRYPTO';
  confidenceScore: number; // 0 to 1
}

export interface ConciergeQuoteContext {
  deskRatePerUsd: number; // e.g. 85.50
  bankName: string;
  bankAccountDetails: string;
  quoteValidityMinutes?: number; // default 15 mins
}

export interface ConciergeResponsePayload {
  parsedInquiry: ConciergeParsedInquiry;
  quoteAmountCrypto?: number;
  quoteAmountFiat?: number;
  exchangeRateUsed: number;
  validUntilIso: string;
  formattedReplyMessage: string;
  requiresOperatorHumanReview: boolean;
}

/**
 * Parses raw text from WhatsApp or Telegram to detect transaction parameters.
 */
export function parseCustomerChatMessage(message: string): ConciergeParsedInquiry {
  const clean = message.toLowerCase().trim();

  // 1. Detect Intent
  let intent: ConciergeIntent = 'UNRECOGNIZED';
  if (/hola|buen(as|os)|saludos|que tal/i.test(clean) && clean.length < 25) {
    intent = 'GREETING';
  } else if (/comprobante|capture|pago realizado|ya transfer[ií]|listo el pago|aqui esta el capture/i.test(clean)) {
    intent = 'PAYMENT_PROOF_SENT';
  } else if (/datos|cuenta|donde transfiero|pasa los datos|numero de cuenta|pago movil/i.test(clean) && !/\d{2,}/.test(clean)) {
    intent = 'BANK_DETAILS_REQUEST';
  } else if (/cuanto|tasa|precio|cotiz|cambi|tienes|disponible|\$/i.test(clean) || /\d+/.test(clean)) {
    intent = 'QUOTE_REQUEST';
  }

  // 2. Detect Operation Type (Customer perspective)
  // "vendo 100 usdt" -> customer sells crypto to desk
  // "compro 100 usdt" -> customer buys crypto from desk
  let opType: 'BUY_CRYPTO' | 'SELL_CRYPTO' = 'SELL_CRYPTO'; // Default desk buys crypto from client
  if (/compro|quiero usdt|necesito usdt|tienes usdt|busco usdt/i.test(clean)) {
    opType = 'BUY_CRYPTO';
  } else if (/vendo|tengo usdt|cambio usdt|recibes usdt/i.test(clean)) {
    opType = 'SELL_CRYPTO';
  }

  // 3. Extract numeric amount
  let detectedAmount: number | undefined;
  const numMatch = clean.match(/(?:(?:usdt|\$|bs|ref)\s*)?(\d+(?:[.,]\d{1,2})?)(?:\s*(?:usdt|\$|bs|dolares|dólares))?/i);
  if (numMatch && numMatch[1]) {
    const rawNum = numMatch[1].replace(',', '.');
    const parsed = parseFloat(rawNum);
    if (!isNaN(parsed) && parsed > 0 && parsed < 1000000) {
      detectedAmount = parsed;
    }
  }

  // 4. Detect Currency
  let detectedCurrency = 'USDT';
  if (/bolivares|bolívares|\bbs\b|ves/i.test(clean)) {
    detectedCurrency = 'VES';
  }

  // 5. Detect Bank Rail
  let detectedBankRail: string | undefined;
  if (/pago\s*m[oó]vil/i.test(clean)) detectedBankRail = 'Pago Móvil';
  else if (/banesco/i.test(clean)) detectedBankRail = 'Banesco';
  else if (/mercantil/i.test(clean)) detectedBankRail = 'Mercantil';
  else if (/provincial|bbva/i.test(clean)) detectedBankRail = 'Provincial';
  else if (/venezuela|bdv/i.test(clean)) detectedBankRail = 'Banco de Venezuela';
  else if (/zelle/i.test(clean)) detectedBankRail = 'Zelle';

  const confidence = detectedAmount ? 0.9 : 0.6;

  return {
    intent,
    detectedAmount,
    detectedCurrency,
    detectedBankRail,
    operationType: opType,
    confidenceScore: confidence,
  };
}

/**
 * Generates an automated, professional WhatsApp concierge reply based on the parsed inquiry.
 */
export function generateConciergeReply(
  inquiry: ConciergeParsedInquiry,
  context: ConciergeQuoteContext,
): ConciergeResponsePayload {
  const rate = context.deskRatePerUsd;
  const validityMins = context.quoteValidityMinutes ?? 15;
  const validUntil = new Date(Date.now() + validityMins * 60000).toISOString();
  const timeFormatted = new Date(Date.now() + validityMins * 60000).toLocaleTimeString('es-VE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  let quoteCrypto: number | undefined;
  let quoteFiat: number | undefined;
  let replyText = '';
  let requiresReview = false;

  if (inquiry.intent === 'GREETING') {
    replyText = `👋 ¡Hola! Bienvenido a nuestra Mesa de Cambio P2P.\n\nActualmente tenemos liquidez activa en *Banesco, Mercantil y Pago Móvil*.\n\n📊 *Tasa del Momento:* 1 USDT = ${rate.toFixed(2)} Bs\n\n¿Qué monto te gustaría consultar o cambiar hoy?`;
  } else if (inquiry.intent === 'PAYMENT_PROOF_SENT') {
    replyText = `📥 *Comprobante recibido con éxito.*\n\nEstamos conciliando la referencia en nuestra banca electrónica. Una vez confirmado en cuenta, liberaremos tu operación en menos de 3 minutos.\n\n¡Gracias por tu paciencia!`;
    requiresReview = true;
  } else if (inquiry.intent === 'BANK_DETAILS_REQUEST') {
    replyText = `🏦 *DATOS BANCARIOS OFICIALES PARA TRANSFERIR:*\n\n${context.bankAccountDetails}\n\n⚠️ *Regla de Oro:* Solo recibimos fondos del titular de la cuenta (Cero terceros). Por favor envía el comprobante tras transferir.`;
  } else {
    // QUOTE_REQUEST
    const amount = inquiry.detectedAmount ?? 100;
    if (inquiry.detectedCurrency === 'VES') {
      quoteFiat = amount;
      quoteCrypto = roundMoney(amount / rate, 2);
    } else {
      quoteCrypto = amount;
      quoteFiat = roundMoney(amount * rate, 2);
    }

    replyText = [
      `📊 *COTIZACIÓN OFICIAL — MESA P2P*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `▪ *Monto a Liquidar:* ${quoteCrypto} USDT`,
      `▪ *Tasa Aplicada:* 1 USDT = ${rate.toFixed(2)} Bs`,
      `▪ *Total a Recibir:* Bs ${quoteFiat.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`,
      `▪ *Destino:* ${inquiry.detectedBankRail || context.bankName}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⏱️ *Cotización válida por ${validityMins} min* (hasta las ${timeFormatted}).`,
      `\n¿Confirmamos la operación para enviarte los datos de transferencia?`,
    ].join('\n');
  }

  return {
    parsedInquiry: inquiry,
    quoteAmountCrypto: quoteCrypto,
    quoteAmountFiat: quoteFiat,
    exchangeRateUsed: rate,
    validUntilIso: validUntil,
    formattedReplyMessage: replyText,
    requiresOperatorHumanReview: requiresReview,
  };
}
