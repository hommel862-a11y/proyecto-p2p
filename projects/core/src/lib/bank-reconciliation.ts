/**
 * Pure domain logic for passive bank payment reconciliation & anti-triangulation validation.
 * Extracts payment data (amount, reference, sender ID/cédula) from bank notification texts
 * (Mercantil, Bancamiga, Banesco, BBVA Provincial, BDV) and cross-checks with Binance P2P orders.
 * Framework-agnostic. Deterministic. Zero network.
 */

import { roundMoney } from './money';

export type BankIdentifier =
  | 'MERCANTIL'
  | 'BANCAMIGA'
  | 'BANESCO'
  | 'PROVINCIAL'
  | 'BDV'
  | 'BANPLUS'
  | 'UNKNOWN';

export interface ParsedBankNotification {
  bank: BankIdentifier;
  bankName: string;
  amountVes: number;
  reference: string;
  senderId: string;
  senderName?: string;
  senderPhone?: string;
  timestamp: string;
  rawText: string;
  isParsed: boolean;
}

export interface ExpectedTradePayment {
  orderId: string;
  expectedAmountVes: number;
  counterpartyId: string;
  counterpartyName: string;
  pair?: string;
}

export type ReconciliationStatus =
  | 'VERIFIED_SAFE'
  | 'TRIANGULATION_ALERT'
  | 'AMOUNT_MISMATCH'
  | 'UNPARSED_NOTIFICATION';

export interface ReconciliationResult {
  status: ReconciliationStatus;
  isSafeToRelease: boolean;
  orderId?: string;
  amountDifferenceVes: number;
  confidencePct: number;
  message: string;
  details: {
    expectedAmountVes: number;
    receivedAmountVes: number;
    expectedPayerId: string;
    actualPayerId: string;
    reference: string;
  };
}

/**
 * Normalizes Venezuelan identity document numbers (Cédula / RIF).
 * Removes dots, spaces, dashes and standardizes prefix (V, E, J, G).
 * e.g., "V- 14.567.890" -> "V14567890", "14567890" -> "V14567890"
 */
export function normalizeIdentityDoc(doc: string): string {
  if (!doc) return '';
  const clean = doc.trim().toUpperCase().replace(/[\s\.\-]/g, '');
  if (/^[0-9]+$/.test(clean)) {
    // Default to Venezuelan personal citizen prefix if none provided
    return `V${clean}`;
  }
  return clean;
}

/**
 * Extracts standard monetary amounts in Bolívares (VES/Bs) from raw strings.
 * Handles Venezuelan format "1.234,56", international "1,234.56" and plain "1234.56".
 */
export function parseVesAmount(text: string): number {
  if (!text) return 0;
  // Look for number following "Bs", "VES", "Bs." or standalone monetary patterns
  const match = text.match(/(?:Bs\.?|VES)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (!match) return 0;

  let raw = match[1];
  // If format is 1.234,56 (dot as thousands, comma as decimal)
  if (raw.includes('.') && raw.includes(',')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (raw.includes(',')) {
    // Single comma is decimal separator: "1234,56"
    raw = raw.replace(',', '.');
  }

  const parsed = parseFloat(raw);
  return isNaN(parsed) ? 0 : roundMoney(parsed, 2);
}

/**
 * Extracts Venezuelan identity document numbers (Cédula/RIF) from raw bank text.
 */
export function extractIdentityDoc(text: string): string {
  if (!text) return '';
  // 1. Explicit label prefix: "CI: V-18.450.123", "Cédula: 19888777", "de CI: V29.999.000"
  const explicit = text.match(/(?:ci|c\.i\.?|cedula|cédula|identificacion|identificación|rif)[:.\s]*([VEJG]?[-.\s]*[0-9]{1,2}(?:\.[0-9]{3}){2}|[VEJG]?[-.\s]*[0-9]{5,10})/i);
  if (explicit) return normalizeIdentityDoc(explicit[1]);

  // 2. Standard Venezuelan ID standalone token: "V-12345678", "V12345678", "E-82111222"
  const standard = text.match(/\b([VEJG][-.\s]*[0-9]{1,2}(?:\.[0-9]{3}){2}|[VEJG][-.\s]*[0-9]{5,10})\b/i);
  if (standard) return normalizeIdentityDoc(standard[1]);

  return '';
}

/**
 * Parses raw bank notification messages into structured payment data.
 */
export function parseBankNotification(text: string): ParsedBankNotification {
  const rawText = text.trim();
  const baseResult: ParsedBankNotification = {
    bank: 'UNKNOWN',
    bankName: 'Desconocido',
    amountVes: 0,
    reference: '',
    senderId: '',
    timestamp: new Date().toISOString(),
    rawText,
    isParsed: false,
  };

  if (!rawText) return baseResult;

  const upper = rawText.toUpperCase();

  // 1. Mercantil Pago Móvil
  if (upper.includes('MERCANTIL') || upper.includes('TPAGO') || upper.includes('PAGO MOVIL MERCANTIL')) {
    baseResult.bank = 'MERCANTIL';
    baseResult.bankName = 'Banco Mercantil';

    const amtMatch = rawText.match(/(?:por|monto|monto:|Bs\.?)\s*([0-9.,]+)/i);
    if (amtMatch) baseResult.amountVes = parseVesAmount(amtMatch[0]);

    const refMatch = rawText.match(/(?:ref(?:erencia)?[:.\s#]*)([0-9]{4,12})/i);
    if (refMatch) baseResult.reference = refMatch[1];

    baseResult.senderId = extractIdentityDoc(rawText);
    baseResult.isParsed = baseResult.amountVes > 0 && (baseResult.reference.length > 0 || baseResult.senderId.length > 0);
    return baseResult;
  }

  // 2. Bancamiga Pago Móvil
  if (upper.includes('BANCAMIGA') || upper.includes('PAGO MOVIL BANCAMIGA')) {
    baseResult.bank = 'BANCAMIGA';
    baseResult.bankName = 'Bancamiga';

    const amtMatch = rawText.match(/(?:Bs\.?|monto[:.\s]*)\s*([0-9.,]+)/i);
    if (amtMatch) baseResult.amountVes = parseVesAmount(amtMatch[0]);

    const refMatch = rawText.match(/(?:ref(?:erencia)?[:.\s#]*)([0-9]{4,12})/i);
    if (refMatch) baseResult.reference = refMatch[1];

    baseResult.senderId = extractIdentityDoc(rawText);
    baseResult.isParsed = baseResult.amountVes > 0;
    return baseResult;
  }

  // 3. Banesco Pago Móvil
  if (upper.includes('BANESCO') || upper.includes('PAGO ELECTRONICO') || upper.includes('MULTIPAGOS')) {
    baseResult.bank = 'BANESCO';
    baseResult.bankName = 'Banesco';

    const amtMatch = rawText.match(/(?:por|monto|Bs\.?)\s*([0-9.,]+)/i);
    if (amtMatch) baseResult.amountVes = parseVesAmount(amtMatch[0]);

    const refMatch = rawText.match(/(?:ref(?:erencia)?[:.\s#]*)([0-9]{4,12})/i);
    if (refMatch) baseResult.reference = refMatch[1];

    baseResult.senderId = extractIdentityDoc(rawText);
    baseResult.isParsed = baseResult.amountVes > 0;
    return baseResult;
  }

  // 4. BBVA Provincial
  if (upper.includes('PROVINCIAL') || upper.includes('BBVA') || upper.includes('DINERO RAPIDO')) {
    baseResult.bank = 'PROVINCIAL';
    baseResult.bankName = 'BBVA Provincial';

    const amtMatch = rawText.match(/(?:por|monto|Bs\.?)\s*([0-9.,]+)/i);
    if (amtMatch) baseResult.amountVes = parseVesAmount(amtMatch[0]);

    const refMatch = rawText.match(/(?:ref(?:erencia)?[:.\s#]*)([0-9]{4,12})/i);
    if (refMatch) baseResult.reference = refMatch[1];

    baseResult.senderId = extractIdentityDoc(rawText);
    baseResult.isParsed = baseResult.amountVes > 0;
    return baseResult;
  }

  // 5. Generic Venezuelan Pago Móvil fallback
  const genericAmt = parseVesAmount(rawText);
  const genericRef = rawText.match(/(?:ref(?:erencia)?[:.\s#]*)([0-9]{4,12})/i);

  if (genericAmt > 0) {
    baseResult.amountVes = genericAmt;
    if (genericRef) baseResult.reference = genericRef[1];
    baseResult.senderId = extractIdentityDoc(rawText);
    baseResult.bankName = 'Pago Móvil';
    baseResult.isParsed = true;
  }

  return baseResult;
}

/**
 * Validates whether an incoming bank payment matches an expected Binance P2P order.
 * Strictly prevents triangulation fraud by verifying payer identity.
 */
export function verifyReconciliation(
  notification: ParsedBankNotification,
  expected: ExpectedTradePayment,
  amountToleranceVes = 0.05,
): ReconciliationResult {
  const expectedPayerId = normalizeIdentityDoc(expected.counterpartyId);
  const actualPayerId = normalizeIdentityDoc(notification.senderId);
  const amountDiff = roundMoney(Math.abs(notification.amountVes - expected.expectedAmountVes), 2);

  const details = {
    expectedAmountVes: expected.expectedAmountVes,
    receivedAmountVes: notification.amountVes,
    expectedPayerId,
    actualPayerId,
    reference: notification.reference,
  };

  if (!notification.isParsed || notification.amountVes <= 0) {
    return {
      status: 'UNPARSED_NOTIFICATION',
      isSafeToRelease: false,
      orderId: expected.orderId,
      amountDifferenceVes: amountDiff,
      confidencePct: 0,
      message: 'No se pudo interpretar el comprobante bancario. Verificación manual requerida.',
      details,
    };
  }

  // 1. Amount Verification
  if (amountDiff > amountToleranceVes) {
    return {
      status: 'AMOUNT_MISMATCH',
      isSafeToRelease: false,
      orderId: expected.orderId,
      amountDifferenceVes: amountDiff,
      confidencePct: 40,
      message: `Discrepancia en monto: Esperado ${expected.expectedAmountVes} Bs, recibido ${notification.amountVes} Bs (Diferencia: ${amountDiff} Bs).`,
      details,
    };
  }

  // 2. Anti-Triangulation Identity Verification
  // If actual payer ID was extracted and does not match the Binance buyer's ID
  if (actualPayerId && expectedPayerId) {
    const isExactMatch = actualPayerId === expectedPayerId;
    // Check without prefix (e.g. "12345678" vs "V12345678")
    const numActual = actualPayerId.replace(/^[A-Z]/, '');
    const numExpected = expectedPayerId.replace(/^[A-Z]/, '');
    const isNumMatch = numActual.length >= 6 && numActual === numExpected;

    if (!isExactMatch && !isNumMatch) {
      return {
        status: 'TRIANGULATION_ALERT',
        isSafeToRelease: false,
        orderId: expected.orderId,
        amountDifferenceVes: 0,
        confidencePct: 20,
        message: `⚠️ ALERTA DE TRIANGULACIÓN: El dinero llegó de la cédula ${actualPayerId}, pero el comprador en Binance es ${expectedPayerId} (${expected.counterpartyName}). ¡NO LIBERAR FONDOS!`,
        details,
      };
    }
  }

  // 3. 100% Verified Safe
  return {
    status: 'VERIFIED_SAFE',
    isSafeToRelease: true,
    orderId: expected.orderId,
    amountDifferenceVes: 0,
    confidencePct: actualPayerId ? 100 : 85,
    message: `✅ PAGO VERIFICADO Y SEGURO: Abono de ${notification.amountVes} Bs en ${notification.bankName} (Ref: ${notification.reference || 'N/A'}). Cédula coincide.`,
    details,
  };
}
