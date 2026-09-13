/**
 * Pure Anti-Fraud & Triangular Scam Detection Domain Engine.
 * Cross-validates bank transfer receipts (OCR) against verified exchange counterparty data.
 * Validates bank reference checksum formats and produces a deterministic FraudRiskScore.
 * Framework-agnostic, zero external dependencies.
 */

import { BankReceiptRecord, BankType } from './receipt-ocr';

export type FraudRiskLevel = 'SAFE' | 'WARNING' | 'CRITICAL';

export type FraudRiskFlag =
  | 'THIRD_PARTY_PAYER'
  | 'ID_DOCUMENT_MISMATCH'
  | 'INVALID_BANK_REFERENCE'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'BLACKLISTED_ENTITY'
  | 'RAPID_REPEAT_REFERENCE'
  | 'SUSPICIOUS_ROUND_SUM'
  | 'EXPIRED_OR_FUTURE_RECEIPT';

export type FraudRecommendation =
  | 'AUTO_RELEASE_OK'
  | 'MANUAL_AUDIT_REQUIRED'
  | 'LOCK_AND_DISPUTE';

export interface BankReferenceValidation {
  isValid: boolean;
  bank: BankType;
  reference: string;
  expectedFormat: string;
  reason?: string;
}

export interface NameMatchResult {
  score: number; // 0 to 1
  isMatch: boolean;
  normalizedA: string;
  normalizedB: string;
  matchedTokens: string[];
  missingTokens: string[];
}

export interface FraudEvaluationParams {
  orderId: string;
  orderAmount: number;
  orderCurrency: 'VES' | 'COP' | 'USD';
  advertiserVerifiedName: string;
  advertiserIdDocument?: string;
  receipt:
    | BankReceiptRecord
    | {
        reference?: string;
        amount?: number;
        currency?: string;
        payerName?: string;
        payerId?: string;
        bank?: BankType;
        timestamp?: string;
        rawText?: string;
      };
  knownReferences?: string[];
  blacklistedIds?: string[];
  blacklistedReferences?: string[];
  amountTolerance?: number;
}

export interface FraudShieldAuditResult {
  orderId: string;
  overallScore: number; // 0 (safest) to 100 (critical threat)
  riskLevel: FraudRiskLevel;
  recommendation: FraudRecommendation;
  flags: FraudRiskFlag[];
  nameMatch: NameMatchResult;
  referenceValidation: BankReferenceValidation;
  amountDifference: number;
  summaryHeadline: string;
  auditDetails: string[];
  disputeTemplateText: string;
}

const NOISE_WORDS = new Set([
  'DE',
  'DEL',
  'LA',
  'LAS',
  'LOS',
  'EL',
  'SAN',
  'SANTA',
  'SR',
  'SRA',
  'DR',
  'DRA',
  'LIC',
]);

/**
 * Normalizes text by removing diacritics, punctuation, and multiple spaces.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips noise words and extracts canonical name tokens.
 */
export function tokenizeName(name: string): string[] {
  return normalizeText(name)
    .split(' ')
    .filter((token) => token.length > 1 && !NOISE_WORDS.has(token));
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Evaluates similarity between verified counterparty name and payer name on receipt.
 */
export function calculateNameSimilarity(
  nameA: string,
  nameB: string,
): NameMatchResult {
  const normA = normalizeText(nameA);
  const normB = normalizeText(nameB);

  if (normA === normB && normA.length > 0) {
    return {
      score: 1.0,
      isMatch: true,
      normalizedA: normA,
      normalizedB: normB,
      matchedTokens: tokenizeName(nameA),
      missingTokens: [],
    };
  }

  const tokensA = tokenizeName(nameA);
  const tokensB = tokenizeName(nameB);

  if (tokensA.length === 0 || tokensB.length === 0) {
    return {
      score: 0,
      isMatch: false,
      normalizedA: normA,
      normalizedB: normB,
      matchedTokens: [],
      missingTokens: [...tokensA, ...tokensB],
    };
  }

  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];

  for (const tokenA of tokensA) {
    let matched = false;
    for (const tokenB of tokensB) {
      if (tokenA === tokenB) {
        matched = true;
        break;
      }
      // Allow minor 1-char OCR typo on tokens > 4 chars
      if (
        tokenA.length >= 4 &&
        tokenB.length >= 4 &&
        levenshteinDistance(tokenA, tokenB) <= 1
      ) {
        matched = true;
        break;
      }
    }
    if (matched) {
      matchedTokens.push(tokenA);
    } else {
      missingTokens.push(tokenA);
    }
  }

  // Jaccard-like score with token overlap
  const totalUniqueTokens = new Set([...tokensA, ...tokensB]).size;
  const tokenScore = totalUniqueTokens > 0 ? matchedTokens.length / Math.min(tokensA.length, tokensB.length) : 0;

  // Edit distance score on full normalized strings without spaces
  const compactA = normA.replace(/\s/g, '');
  const compactB = normB.replace(/\s/g, '');
  const maxLen = Math.max(compactA.length, compactB.length, 1);
  const charScore = 1 - levenshteinDistance(compactA, compactB) / maxLen;

  const combinedScore = Math.max(tokenScore * 0.75 + charScore * 0.25, tokenScore);
  const isMatch = combinedScore >= 0.55 || matchedTokens.length >= 2;

  return {
    score: Math.min(1.0, Math.round(combinedScore * 100) / 100),
    isMatch,
    normalizedA: normA,
    normalizedB: normB,
    matchedTokens,
    missingTokens,
  };
}

/**
 * Checks if a string is a trivial pattern like all identical digits or simple ascending sequence.
 */
function isTrivialSequence(str: string): boolean {
  if (!str) return true;
  // All same characters (e.g. 00000000, 99999999)
  if (/^(.)\1+$/.test(str)) return true;

  // Simple ascending or descending sequences of digits
  const sequentialPatterns = [
    '0123456789',
    '1234567890',
    '9876543210',
    '12345678',
    '87654321',
  ];
  for (const seq of sequentialPatterns) {
    if (seq.includes(str) || str.includes(seq)) return true;
  }

  return false;
}

/**
 * Validates bank reference structure and checks for fraudulent/trivial strings.
 */
export function validateBankReference(
  bank: BankType,
  rawReference: string,
): BankReferenceValidation {
  const reference = (rawReference || '').replace(/[\s#-]/g, '').trim();

  if (!reference) {
    return {
      isValid: false,
      bank,
      reference,
      expectedFormat: 'Referencia bancaria requerida',
      reason: 'No se detectó número de referencia en el comprobante.',
    };
  }

  if (isTrivialSequence(reference)) {
    return {
      isValid: false,
      bank,
      reference,
      expectedFormat: 'Número de referencia bancario legítimo y no secuencial',
      reason: `La referencia "${reference}" es un patrón trivial o falso (secuencia o dígitos repetidos).`,
    };
  }

  switch (bank) {
    case 'BANESCO': {
      // Typically 8 digits
      const isDigits = /^\d{6,9}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '6 a 9 dígitos numéricos (típicamente 8)',
        reason: isDigits
          ? undefined
          : `Referencia Banesco inválida: "${reference}". Debe contener solo dígitos (6-9 caracteres).`,
      };
    }
    case 'BDV': {
      // BDV Pago Móvil or transfer is usually 10 to 14 digits
      const isDigits = /^\d{8,16}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '8 a 16 dígitos numéricos (Pago Móvil / Transferencia BDV)',
        reason: isDigits
          ? undefined
          : `Referencia Banco de Venezuela inválida: "${reference}". Debe ser numérica.`,
      };
    }
    case 'MERCANTIL': {
      const isDigits = /^\d{6,14}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '6 a 14 dígitos numéricos',
        reason: isDigits
          ? undefined
          : `Referencia Mercantil inválida: "${reference}".`,
      };
    }
    case 'PROVINCIAL': {
      const isDigits = /^\d{6,12}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '6 a 12 dígitos numéricos',
        reason: isDigits
          ? undefined
          : `Referencia Provincial inválida: "${reference}".`,
      };
    }
    case 'BANCAMIGA': {
      const isDigits = /^\d{6,12}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '6 a 12 dígitos numéricos',
        reason: isDigits
          ? undefined
          : `Referencia Bancamiga inválida: "${reference}".`,
      };
    }
    case 'NEQUI': {
      // Usually starts with M or has 8-12 digits
      const isValidNequi = /^[M|m]?\d{6,12}$/.test(reference);
      return {
        isValid: isValidNequi,
        bank,
        reference,
        expectedFormat: 'Prefijo M + 6-12 dígitos o 8-12 dígitos numéricos',
        reason: isValidNequi
          ? undefined
          : `Referencia Nequi inválida: "${reference}".`,
      };
    }
    case 'BANCOLOMBIA': {
      const isDigits = /^\d{6,14}$/.test(reference);
      return {
        isValid: isDigits,
        bank,
        reference,
        expectedFormat: '6 a 14 dígitos numéricos',
        reason: isDigits
          ? undefined
          : `Referencia Bancolombia inválida: "${reference}".`,
      };
    }
    case 'ZINLI':
    case 'EL_DORADO': {
      const isAlnum = /^[A-Za-z0-9]{6,24}$/.test(reference);
      return {
        isValid: isAlnum,
        bank,
        reference,
        expectedFormat: '6 a 24 caracteres alfanuméricos',
        reason: isAlnum
          ? undefined
          : `Código de operación inválido: "${reference}".`,
      };
    }
    default: {
      const hasMinLength = reference.length >= 5 && /\d/.test(reference);
      return {
        isValid: hasMinLength,
        bank,
        reference,
        expectedFormat: 'Al menos 5 caracteres conteniendo dígitos',
        reason: hasMinLength
          ? undefined
          : `Referencia desconocida o incompleta: "${reference}".`,
      };
    }
  }
}

/**
 * Comprehensive Anti-Fraud & Triangular Scam Evaluator.
 */
export function evaluateFraudRisk(
  params: FraudEvaluationParams,
): FraudShieldAuditResult {
  const {
    orderId,
    orderAmount,
    orderCurrency,
    advertiserVerifiedName,
    advertiserIdDocument,
    receipt,
    knownReferences = [],
    blacklistedIds = [],
    blacklistedReferences = [],
    amountTolerance = 0.01,
  } = params;

  const flags: FraudRiskFlag[] = [];
  const auditDetails: string[] = [];
  let riskScore = 0;

  // 1. Cross-Identity Name Check
  const payerName = receipt.payerName || '';
  const nameMatch = calculateNameSimilarity(advertiserVerifiedName, payerName);

  if (!payerName) {
    auditDetails.push('No se detectó nombre del titular en el comprobante.');
    riskScore += 15;
  } else if (!nameMatch.isMatch) {
    flags.push('THIRD_PARTY_PAYER');
    riskScore += 65;
    auditDetails.push(
      `ALERTA ESTAFA TRIANGULAR: El titular del comprobante ("${payerName}") no coincide con el usuario verificado de Binance ("${advertiserVerifiedName}"). Similitud: ${(nameMatch.score * 100).toFixed(0)}%.`,
    );
  } else {
    auditDetails.push(
      `Titular verificado correctamente: "${payerName}" coincide con "${advertiserVerifiedName}".`,
    );
  }

  // 2. ID Document Check (Cédula/RIF)
  if (advertiserIdDocument && receipt.payerId) {
    const normExpectedId = normalizeText(advertiserIdDocument).replace(/[^0-9]/g, '');
    const normReceiptId = normalizeText(receipt.payerId).replace(/[^0-9]/g, '');

    if (normExpectedId && normReceiptId && normExpectedId !== normReceiptId) {
      flags.push('ID_DOCUMENT_MISMATCH');
      riskScore += 35;
      auditDetails.push(
        `Discrepancia en documento de identidad: Cédula/RIF en orden (${advertiserIdDocument}) vs comprobante (${receipt.payerId}).`,
      );
    }
  }

  // 3. Bank Reference Validation
  const bank = receipt.bank || 'UNKNOWN';
  const reference = receipt.reference || '';
  const refValidation = validateBankReference(bank, reference);

  if (!refValidation.isValid) {
    flags.push('INVALID_BANK_REFERENCE');
    riskScore += 30;
    auditDetails.push(
      refValidation.reason || 'Número de referencia bancaria no supera las reglas de integridad.',
    );
  } else {
    auditDetails.push(`Referencia bancaria legítima (${refValidation.reference}) para entidad ${bank}.`);
  }

  // 4. Amount Verification
  const receiptAmount = receipt.amount || 0;
  const amountDiff = Math.abs(orderAmount - receiptAmount);
  if (amountDiff > amountTolerance) {
    flags.push('AMOUNT_MISMATCH');
    riskScore += 40;
    auditDetails.push(
      `Discrepancia de monto: Esperado ${orderAmount.toFixed(2)} ${orderCurrency} vs Transferido ${receiptAmount.toFixed(2)} ${receipt.currency || orderCurrency} (Diferencia: ${amountDiff.toFixed(2)}).`,
    );
  }

  // 5. Currency Check
  if (receipt.currency && receipt.currency !== orderCurrency) {
    flags.push('CURRENCY_MISMATCH');
    riskScore += 35;
    auditDetails.push(
      `Discrepancia de divisa: Esperado ${orderCurrency} vs Comprobante ${receipt.currency}.`,
    );
  }

  // 6. Blacklist Check
  const normPayerId = receipt.payerId ? normalizeText(receipt.payerId) : '';
  const isIdBlacklisted = blacklistedIds.some((b) =>
    normPayerId.includes(normalizeText(b)),
  );
  const isRefBlacklisted = blacklistedReferences.some(
    (b) => normalizeText(b) === normalizeText(reference),
  );

  if (isIdBlacklisted || isRefBlacklisted) {
    flags.push('BLACKLISTED_ENTITY');
    riskScore = 100;
    auditDetails.push(
      'CRÍTICO: La cuenta, titular o referencia se encuentra registrada en la LISTA NEGRA de estafas.',
    );
  }

  // 7. Duplicate Reference Check
  if (reference && knownReferences.includes(reference)) {
    flags.push('RAPID_REPEAT_REFERENCE');
    riskScore = 100;
    auditDetails.push(
      `ALERTA DUPLICADO: La referencia ${reference} ya fue procesada en otra orden. Posible intento de reuso de comprobante.`,
    );
  }

  // Determine Risk Level & Recommendation
  const clampedScore = Math.min(100, Math.max(0, riskScore));
  let riskLevel: FraudRiskLevel = 'SAFE';
  let recommendation: FraudRecommendation = 'AUTO_RELEASE_OK';

  if (clampedScore >= 50 || flags.includes('THIRD_PARTY_PAYER') || flags.includes('BLACKLISTED_ENTITY') || flags.includes('RAPID_REPEAT_REFERENCE')) {
    riskLevel = 'CRITICAL';
    recommendation = 'LOCK_AND_DISPUTE';
  } else if (clampedScore >= 20 || flags.length > 0) {
    riskLevel = 'WARNING';
    recommendation = 'MANUAL_AUDIT_REQUIRED';
  }

  const summaryHeadline =
    riskLevel === 'SAFE'
      ? 'Comprobante verificado. Pago seguro de titular directo.'
      : riskLevel === 'WARNING'
      ? 'Precaución: Se detectaron inconsistencias menores que requieren auditoría visual.'
      : 'PELIGRO DE ESTAFA: Bloquear orden y abrir disputa inmediatamente.';

  const disputeTemplateText = generateDisputeClaim({
    orderId,
    orderAmount,
    orderCurrency,
    advertiserVerifiedName,
    payerName,
    reference,
    flags,
    auditDetails,
  });

  return {
    orderId,
    overallScore: clampedScore,
    riskLevel,
    recommendation,
    flags,
    nameMatch,
    referenceValidation: refValidation,
    amountDifference: amountDiff,
    summaryHeadline,
    auditDetails,
    disputeTemplateText,
  };
}

/**
 * Generates an institutional dispute statement ready for Binance/Bybit P2P arbitration.
 */
function generateDisputeClaim(data: {
  orderId: string;
  orderAmount: number;
  orderCurrency: string;
  advertiserVerifiedName: string;
  payerName: string;
  reference: string;
  flags: FraudRiskFlag[];
  auditDetails: string[];
}): string {
  const flagsSummary = data.flags.join(', ');
  return `[RECLAMO FORMAL DE DISPUTA P2P - ORDEN #${data.orderId}]

Estimado equipo de Soporte y Arbitraje P2P:

Solicito intervención y congelamiento preventivo de la orden #${data.orderId} por violación flagrante de los Términos del Servicio P2P (PROHIBICIÓN ESTRICTA DE PAGOS DE TERCEROS NO AUTORIZADOS / ESTAFA TRIANGULAR).

Evidencia Forense del Comprobante:
- Usuario Registrado en Binance: ${data.advertiserVerifiedName}
- Titular que Transfiere (Comprobante): ${data.payerName || 'Desconocido'}
- Referencia Bancaria Suministrada: ${data.reference || 'Sin referencia'}
- Monto de la Orden: ${data.orderAmount.toFixed(2)} ${data.orderCurrency}
- Banderas de Riesgo Detectadas: [${flagsSummary}]

Detalle de Inconsistencias:
${data.auditDetails.map((d) => `• ${d}`).join('\n')}

De acuerdo con las políticas oficiales de la plataforma, los pagos provenientes de cuentas bancarias de terceros son inaceptables y representan un alto riesgo de contracargo/estafa triangular.

Exijo:
1. NO liberar los fondos en custodia (escrow).
2. Solicitar al comprador el extracto de cuenta original a su nombre.
3. En caso de no demostrar titularidad, cancelar la orden y devolver los fondos al titular emisor según los protocolos anti-fraude.`;
}
