/**
 * Pure Bank Receipt & OCR Parser Domain Engine.
 * Parses raw text extracted from bank transfer receipts, Pago Móvil screenshots,
 * and wallet confirmations (BDV, Banesco, Mercantil, Bancolombia, Nequi, Zinli).
 * Framework-agnostic. No network, no Angular, no heavy OCR binary dependency.
 */

export type BankType =
  | 'BDV'
  | 'BANESCO'
  | 'MERCANTIL'
  | 'PROVINCIAL'
  | 'BANCAMIGA'
  | 'BANCOLOMBIA'
  | 'NEQUI'
  | 'ZINLI'
  | 'EL_DORADO'
  | 'UNKNOWN';

export interface BankReceiptRecord {
  id: string;
  reference: string;
  amount: number;
  currency: 'VES' | 'COP' | 'USD';
  bank: BankType;
  bankDisplayName: string;
  payerName?: string;
  payerId?: string; // Cédula/NIT
  beneficiaryName?: string;
  beneficiaryPhone?: string;
  timestamp?: string;
  rawText: string;
  confidenceScore: number; // 0 to 1
  isDuplicate?: boolean;
  antiTriangulationAlert?: boolean;
  antiTriangulationReason?: string;
}

const BANK_NAMES: Record<BankType, string> = {
  BDV: 'Banco de Venezuela',
  BANESCO: 'Banesco Banco Universal',
  MERCANTIL: 'Mercantil Banco',
  PROVINCIAL: 'BBVA Provincial',
  BANCAMIGA: 'Bancamiga',
  BANCOLOMBIA: 'Bancolombia',
  NEQUI: 'Nequi Colombia',
  ZINLI: 'Zinli Wallet',
  EL_DORADO: 'El Dorado P2P',
  UNKNOWN: 'Comprobante Desconocido',
};

/**
 * Normalizes number strings from receipts (handling European/Latin '1.250,50' vs US '1,250.50').
 */
export function parseReceiptAmount(str: string): number {
  let cleaned = str.replace(/[^0-9.,]/g, '').replace(/^[.,]+|[.,]+$/g, '').trim();
  if (!cleaned) return 0;

  // Check if Latin format: contains dots as thousand separators and comma as decimal (e.g. 1.250,50)
  if (cleaned.includes('.') && cleaned.includes(',')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      // Latin format: 1.250,50 -> 1250.50
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    } else {
      // US format: 1,250.50 -> 1250.50
      return parseFloat(cleaned.replace(/,/g, ''));
    }
  }

  // If only comma: e.g. 1250,50 or 500,00
  if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(',', '.'));
  }

  // If only dot: check if dot is decimal or thousand separator (e.g. 150.000 vs 1250.50)
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1].length === 3 && parseFloat(parts[0]) > 0) {
      // Likely COP without decimals e.g. 150.000
      return parseFloat(parts[0]) * 1000 + parseFloat(parts[1]);
    }
    return parseFloat(cleaned);
  }

  return parseFloat(cleaned) || 0;
}

/**
 * Detects bank type from receipt text keywords.
 */
export function detectBankType(text: string): BankType {
  const lower = text.toLowerCase();
  if (lower.includes('banesco')) return 'BANESCO';
  if (lower.includes('bdv') || lower.includes('venezuela') || lower.includes('pago móvil bdv') || lower.includes('pagomovil bdv')) return 'BDV';
  if (lower.includes('mercantil')) return 'MERCANTIL';
  if (lower.includes('provincial') || lower.includes('bbva')) return 'PROVINCIAL';
  if (lower.includes('bancamiga')) return 'BANCAMIGA';
  if (lower.includes('bancolombia')) return 'BANCOLOMBIA';
  if (lower.includes('nequi')) return 'NEQUI';
  if (lower.includes('zinli')) return 'ZINLI';
  if (lower.includes('el dorado') || lower.includes('eldorado')) return 'EL_DORADO';
  return 'UNKNOWN';
}

/**
 * Extracts reference number using common banking patterns.
 */
export function extractReference(text: string): string {
  const patterns = [
    /(?:referencia|ref\.?|comprobante|nro\.?\s*de\s*referencia)[:\s#]+([A-Za-z0-9-]{5,24})/i,
    /(?:id\s*de\s*transacci[oó]n|transaction\s*id|id)[:\s#]+([A-Za-z0-9-]{5,24})/i,
    /(?:nro\.?\s*de\s*operaci[oó]n|nro\.?\s*operaci[oó]n)[:\s#]+([0-9]{6,24})/i,
    /\b(M[0-9]{6,12})\b/i, // Nequi style e.g. M9482014
    /\b([0-9]{8,14})\b/, // Raw 8-14 digit numbers
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) {
      const candidate = (match[1] || match[0]).trim();
      // Ensure candidate contains at least one digit
      if (/\d/.test(candidate)) {
        return candidate;
      }
    }
  }

  return '';
}

/**
 * Extracts Cédula / Document ID (e.g. V-12345678, J-123456789, 12345678).
 */
export function extractIdDocument(text: string): string | undefined {
  // First, check explicit labels like Cédula, CI, Documento, RIF, NIT
  const labelMatch = text.match(/(?:c[eé]dula|c\.?i\.?|rif|documento|nit|id)[:\s]+([VvEeJjGgP-]?\s?[0-9]{6,10})\b/i);
  if (labelMatch) {
    return labelMatch[1].replace(/\s/g, '').toUpperCase();
  }

  // Second, check mandatory prefixed documents like V-18920194 or J-12345678
  const prefixedMatch = text.match(/\b([VvEeJjGgP]-?[0-9]{6,10})\b/);
  if (prefixedMatch) {
    return prefixedMatch[1].toUpperCase();
  }

  return undefined;
}

/**
 * Parses raw text extracted from a banking receipt and normalizes it into a BankReceiptRecord.
 */
export function parseBankReceiptText(
  rawText: string,
  options?: {
    knownReferences?: string[];
    expectedCounterpartyName?: string;
  },
): BankReceiptRecord {
  const bank = detectBankType(rawText);
  const bankDisplayName = BANK_NAMES[bank];

  // Reference
  const reference = extractReference(rawText);

  // Currency detection
  let currency: 'VES' | 'COP' | 'USD' = 'VES';
  const lower = rawText.toLowerCase();
  if (bank === 'BANCOLOMBIA' || bank === 'NEQUI' || lower.includes('cop') || lower.includes('pesos')) {
    currency = 'COP';
  } else if (bank === 'ZINLI' || lower.includes('usd') || lower.includes('dólares') || lower.includes('dolares')) {
    currency = 'USD';
  } else {
    currency = 'VES';
  }

  // Amount extraction
  let amount = 0;
  // Match lines with Monto, Valor, Importe, Bs., $ or Cuanto
  const amountPatterns = [
    /(?:monto|valor|importe|total|cu[aá]nto)[:\s$Bs]*([0-9.,]+)/i,
    /(?:bs\.?|ves)\s*([0-9.,]+)/i,
    /\$\s*([0-9.,]+)/i,
    /([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2}))\s*(?:bs|ves)?/i,
  ];

  for (const regex of amountPatterns) {
    const match = rawText.match(regex);
    if (match && match[1]) {
      const parsed = parseReceiptAmount(match[1]);
      if (parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // Cédula / Document
  const payerId = extractIdDocument(rawText);

  // Payer / Beneficiary Name extraction
  let payerName: string | undefined;
  let beneficiaryName: string | undefined;

  const nameMatch = rawText.match(/(?:pagador|ordenante|emisor|titular|nombre\s+del\s+pagador)[:\s]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
  if (nameMatch) {
    payerName = nameMatch[1].split(/[\r\n]/)[0].trim();
  }

  const benefMatch = rawText.match(/(?:beneficiario|destino|a nombre de|para)[:\s]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
  if (benefMatch) {
    beneficiaryName = benefMatch[1].split(/[\r\n]/)[0].trim();
  }

  // Phone number (e.g. 0414-1234567, 3001234567)
  let beneficiaryPhone: string | undefined;
  const phoneMatch = rawText.match(/\b(04[12][246][-\s]?[0-9]{3}[-\s]?[0-9]{4}|3[0-9]{2}[-\s]?[0-9]{3}[-\s]?[0-9]{4})\b/);
  if (phoneMatch) {
    beneficiaryPhone = phoneMatch[1].replace(/[-\s]/g, '');
  }

  // Date / Timestamp
  let timestamp: string | undefined;
  const dateMatch = rawText.match(/\b([0-9]{2}[/-][0-9]{2}[/-][0-9]{2,4}(?:\s+[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?)\b/);
  if (dateMatch) {
    timestamp = dateMatch[1];
  } else {
    timestamp = new Date().toISOString();
  }

  // Duplication detection
  let isDuplicate = false;
  if (reference && options?.knownReferences) {
    isDuplicate = options.knownReferences.includes(reference);
  }

  // Anti-triangulation check
  let antiTriangulationAlert = false;
  let antiTriangulationReason: string | undefined;

  if (options?.expectedCounterpartyName && payerName) {
    const normExpected = options.expectedCounterpartyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normPayer = payerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // If expected name is not included in payer name and vice versa
    if (!normPayer.includes(normExpected) && !normExpected.includes(normPayer)) {
      antiTriangulationAlert = true;
      antiTriangulationReason = `ALERTA DE SEGURIDAD: El nombre en el comprobante ("${payerName}") no coincide con la contraparte verificada de Binance ("${options.expectedCounterpartyName}"). Posible triangulación de terceros.`;
    }
  }

  // Confidence score calculation
  let confidenceScore = 0.2;
  if (bank !== 'UNKNOWN') confidenceScore += 0.25;
  if (reference.length >= 6) confidenceScore += 0.25;
  if (amount > 0) confidenceScore += 0.3;

  return {
    id: crypto.randomUUID(),
    reference: reference || `REF-${Date.now().toString().slice(-6)}`,
    amount,
    currency,
    bank,
    bankDisplayName,
    payerName,
    payerId,
    beneficiaryName,
    beneficiaryPhone,
    timestamp,
    rawText,
    confidenceScore: Math.min(1, Math.round(confidenceScore * 100) / 100),
    isDuplicate,
    antiTriangulationAlert,
    antiTriangulationReason,
  };
}

/**
 * Exports a collection of parsed bank receipts to an Excel-compatible CSV string (BOM UTF-8).
 */
export function exportReceiptsToCSV(receipts: BankReceiptRecord[]): string {
  const headers = [
    'ID Registro',
    'Banco',
    'Referencia',
    'Monto',
    'Moneda',
    'Emisor / Pagador',
    'Cédula / Documento',
    'Beneficiario',
    'Teléfono',
    'Fecha Comprobante',
    'Confianza OCR',
    'Duplicado',
    'Alerta Triangulación',
  ];

  const rows = receipts.map((r) => [
    `"${r.id}"`,
    `"${r.bankDisplayName}"`,
    `"${r.reference}"`,
    r.amount.toFixed(2),
    `"${r.currency}"`,
    `"${r.payerName || ''}"`,
    `"${r.payerId || ''}"`,
    `"${r.beneficiaryName || ''}"`,
    `"${r.beneficiaryPhone || ''}"`,
    `"${r.timestamp || ''}"`,
    `${(r.confidenceScore * 100).toFixed(0)}%`,
    r.isDuplicate ? '"SI"' : '"NO"',
    r.antiTriangulationAlert ? '"ALERTA"' : '"OK"',
  ]);

  const csvContent = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');
  return `\uFEFF${csvContent}`; // Add UTF-8 BOM so Excel opens with proper accents and signs
}
