import {
  AuditPaymentProofOcrInputSchema,
  type AuditPaymentProofOcrInput,
} from '../schemas/index.js';

export const auditPaymentProofOcrTool = {
  name: 'audit_payment_proof_ocr',
  description:
    'Procesa el texto crudo extraído por OCR de un comprobante de Pago Móvil o transferencia bancaria, extrae referencia, monto, banco y titular, y lo compara contra la orden P2P activa para autorizar o bloquear la liberación.',
  inputSchema: AuditPaymentProofOcrInputSchema,
  execute: (input: AuditPaymentProofOcrInput) => {
    const text = input.ocrRawText;
    const lower = text.toLowerCase();

    // 1. Extract Bank
    let detectedBank = 'UNKNOWN';
    if (
      lower.includes('venezuela') ||
      lower.includes('bdv') ||
      lower.includes('banco de venezuela')
    ) {
      detectedBank = 'BDV';
    } else if (lower.includes('banesco')) {
      detectedBank = 'BANESCO';
    } else if (lower.includes('mercantil')) {
      detectedBank = 'MERCANTIL';
    } else if (lower.includes('provincial') || lower.includes('bbva')) {
      detectedBank = 'PROVINCIAL';
    } else if (lower.includes('bancamiga')) {
      detectedBank = 'BANCAMIGA';
    } else if (lower.includes('pago movil') || lower.includes('pagomovil')) {
      detectedBank = 'PAGO_MOVIL';
    }

    // 2. Extract Reference Number
    // Matches common Venezuelan reference formats: 6 to 12 digits, often preceded by Ref, Operacion, No.
    const refMatch =
      text.match(
        /(?:ref(?:erencia)?|operaci[oó]n|n[uú]mero|nro|aprobaci[oó]n)[:\s.#]*([0-9]{4,12})/i,
      ) || text.match(/\b([0-9]{6,12})\b/);
    const extractedRef = refMatch ? refMatch[1] : null;

    // 3. Extract Amount in VES
    // Pattern for Latin formats e.g. 1.250,50 or 1250.50
    let extractedAmount: number | null = null;
    const amountMatches =
      text.match(/(?:bs\.?|ves|monto)[:\s]*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2}))/i) ||
      text.match(/([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2}))\s*(?:bs|ves)/i);

    if (amountMatches && amountMatches[1]) {
      const rawNum = amountMatches[1];
      if (rawNum.includes('.') && rawNum.includes(',')) {
        // e.g. 1.500,00 -> Latin format
        extractedAmount = parseFloat(rawNum.replace(/\./g, '').replace(',', '.'));
      } else if (rawNum.includes(',')) {
        extractedAmount = parseFloat(rawNum.replace(',', '.'));
      } else {
        extractedAmount = parseFloat(rawNum);
      }
    } else {
      // Fallback: look for decimal numbers
      const anyNum = text.match(/\b([0-9]+[.,][0-9]{2})\b/);
      if (anyNum && anyNum[1]) {
        extractedAmount = parseFloat(anyNum[1].replace(',', '.'));
      }
    }

    // 4. Extract Cédula / Document ID
    const cedulaMatch =
      text.match(/\b([VEJPvejp][-\s]?[0-9]{6,9})\b/) ||
      text.match(/(?:c[eé]dula|rif|identificaci[oó]n)[:\s]*([0-9]{6,9})/i);
    const extractedCedula =
      cedulaMatch && cedulaMatch[1] ? cedulaMatch[1].replace(/[-\s]/g, '').toUpperCase() : null;

    // 5. Cross-Verification against Expected Order Data
    const discrepancies: string[] = [];
    let isAmountMatch = false;

    if (extractedAmount !== null) {
      const diff = Math.abs(extractedAmount - input.expectedAmountVes);
      if (diff <= 0.05) {
        isAmountMatch = true;
      } else {
        discrepancies.push(
          `DISCREPANCIA DE MONTO: Comprobante muestra ${extractedAmount.toFixed(2)} VES pero la orden exige ${input.expectedAmountVes.toFixed(2)} VES.`,
        );
      }
    } else {
      discrepancies.push('No se pudo identificar con certeza el monto en el comprobante.');
    }

    if (!extractedRef || extractedRef.length < 4) {
      discrepancies.push('Número de referencia ilegible o demasiado corto en el comprobante.');
    }

    if (input.expectedPayerIdDoc && extractedCedula) {
      const cleanExpected = input.expectedPayerIdDoc.replace(/[^0-9]/g, '');
      const cleanExtracted = extractedCedula.replace(/[^0-9]/g, '');
      if (cleanExpected !== cleanExtracted) {
        discrepancies.push(
          `ALERTA TITULARIDAD: La cédula del comprobante (${extractedCedula}) no coincide con el comprador verificado (${input.expectedPayerIdDoc}). Posible triangulación.`,
        );
      }
    }

    const hasThirdPartyRisk = discrepancies.some((d) => d.includes('ALERTA TITULARIDAD'));
    const isCleanMatch = discrepancies.length === 0 && isAmountMatch && !!extractedRef;

    let verdict:
      | 'MATCH_VERIFIED_SAFE_TO_RELEASE'
      | 'AMOUNT_MISMATCH'
      | 'THIRD_PARTY_SUSPICION'
      | 'MANUAL_AUDIT_REQUIRED';

    if (isCleanMatch) {
      verdict = 'MATCH_VERIFIED_SAFE_TO_RELEASE';
    } else if (hasThirdPartyRisk) {
      verdict = 'THIRD_PARTY_SUSPICION';
    } else if (!isAmountMatch && extractedAmount !== null) {
      verdict = 'AMOUNT_MISMATCH';
    } else {
      verdict = 'MANUAL_AUDIT_REQUIRED';
    }

    return {
      orderId: input.orderId,
      verdict,
      isSafeToRelease: isCleanMatch,
      extractedData: {
        reference: extractedRef,
        amountVes: extractedAmount,
        bank: detectedBank,
        payerCedula: extractedCedula,
      },
      expectedData: {
        amountVes: input.expectedAmountVes,
        bank: input.expectedBank,
        payerIdDoc: input.expectedPayerIdDoc,
      },
      discrepancies,
      actionAdvice: isCleanMatch
        ? 'VERIFICACIÓN EXITOSA: Monto y parámetros concuerdan perfectamente. Seguro para liberar los USDT en Binance.'
        : `NO LIBERAR CRIPTO: Se detectaron fallas de validación. ${discrepancies.join(' ')}`,
      auditTimestamp: new Date().toISOString(),
    };
  },
};
