/**
 * @file crm-omnichannel-billing.ts
 * @description Pure domain engine for Omnichannel Meta CRM (WhatsApp & Instagram),
 * Meta 24h Free Customer Service Window evaluation, AI Welcome & Triage Classifier,
 * 3-Bubble Anti-Friction Bank Copy Sequence, and Native Invoice/Quote Studio.
 *
 * Architecture: Hexagonal / Clean Architecture.
 * Standard: 100% pure TypeScript, zero Angular/DOM dependencies, fully deterministic.
 */

import {
  type WorkspaceScope,
  type FiatCurrency,
  type PipelineDeal,
  type CrmBankAccount,
  normalizeBankReference,
  verifyReferenceCollision,
} from './client-compliance-intelligence';

// =============================================================================
// 1. MODELS & ENUMS
// =============================================================================

export type MessagingChannel = 'WHATSAPP' | 'INSTAGRAM';

export type AiOperatingMode = 'AUTOPILOT' | 'COPILOT_DRAFT' | 'MANUAL';

export type OmnichannelIntent =
  | 'P2P_EXCHANGE'
  | 'PAYMENT_PROOF'
  | 'QUOTE_INVOICE_REQUEST'
  | 'GENERAL';

export interface OmnichannelMessage {
  id: string;
  conversationId: string;
  channel: MessagingChannel;
  direction: 'INBOUND' | 'OUTBOUND';
  senderHandle: string;
  text: string;
  timestamp: number;
  detectedIntent?: OmnichannelIntent;
  extractedReferenceId?: string;
  extractedAmount?: number;
  imageUrl?: string;
  aiConfidence?: number;
}

export interface OmnichannelConversation {
  id: string;
  scope: WorkspaceScope;
  contactId: string | null;
  contactName: string;
  channel: MessagingChannel;
  recipientPhoneOrIgId: string;
  lastInboundTimestamp: number | null;
  unreadCount: number;
  linkedDealId: string | null;
  messages: OmnichannelMessage[];
}

export interface MetaFreeWindowEvaluation {
  isOpen: boolean;
  remainingMinutes: number;
  costStatus: 'FREE_0_USD' | 'TEMPLATE_REQUIRED';
  lastInboundTimestamp: number | null;
  expiresAtMs: number | null;
}

export interface AiTriageResult {
  targetScope: WorkspaceScope;
  detectedIntent: OmnichannelIntent;
  extractedReferenceId?: string;
  extractedAmount?: number;
  isDuplicateReference: boolean;
  collidingDealId?: string;
  suggestedReplyText: string;
  recommendedKanbanAction:
    | 'CREATE_P2P_DEAL'
    | 'CREATE_360_QUOTE_DEAL'
    | 'ATTACH_PAYMENT_REF'
    | 'NONE';
  confidence: number;
}

export interface CopyableBankBubbles {
  headerBubble: string;
  docIdBubble: string;
  accountOrPhoneBubble: string;
  amountBubble?: string;
  bubbles: string[];
  formattedBlock: string;
}

export type CrmDocumentType =
  | 'PRESUPUESTO_QUOTE'
  | 'FACTURA_INVOICE'
  | 'COMPROBANTE_P2P';

export type BillingLineCategory =
  | 'PRODUCT'
  | 'LABOR_SERVICE'
  | 'P2P_EXCHANGE'
  | 'FEE_OR_TAX';

export interface BillingLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceUsdt: number;
  category: BillingLineCategory;
}

export interface CrmBillingDocument {
  id: string;
  docNumber: string;
  scope: WorkspaceScope;
  docType: CrmDocumentType;
  contactId: string;
  contactName: string;
  contactDocId: string;
  fiatCurrency: FiatCurrency;
  exchangeRate: number;
  items: BillingLineItem[];
  subtotalUsdt: number;
  discountUsdt: number;
  taxOrFeeUsdt: number;
  totalUsdt: number;
  totalFiat: number;
  paymentInstructionsText: string;
  bankReferenceId?: string;
  status: 'DRAFT' | 'SENT' | 'PAID';
  createdAt: number;
}

export interface OmnichannelIntegrationConfig {
  metaAccessToken?: string;
  whatsappPhoneNumberId?: string;
  instagramAccountId?: string;
  geminiApiKey?: string;
  aiMode: AiOperatingMode;
  businessDisplayName: string;
  welcomeTemplateP2p: string;
  welcomeTemplate360: string;
}

export interface GeminiOcrParsedResult {
  bank: string | null;
  reference: string | null;
  amount: number | null;
  currency: FiatCurrency | null;
  date: string | null;
  rawNotes: string;
}

// =============================================================================
// 2. META 24H FREE WINDOW EVALUATION
// =============================================================================

export const META_FREE_WINDOW_MS = 86_400_000; // 24 hours

/**
 * Pure evaluation of the official Meta 24-hour customer service window.
 * Returns whether outbound responses are $0.00 free or require an approved Meta template.
 */
export function evaluateMeta24hFreeWindow(
  lastInboundTimestamp: number | null | undefined,
  nowMs: number = Date.now(),
): MetaFreeWindowEvaluation {
  if (
    lastInboundTimestamp == null ||
    !Number.isFinite(lastInboundTimestamp) ||
    lastInboundTimestamp <= 0
  ) {
    return {
      isOpen: false,
      remainingMinutes: 0,
      costStatus: 'TEMPLATE_REQUIRED',
      lastInboundTimestamp: null,
      expiresAtMs: null,
    };
  }

  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const elapsed = safeNow - lastInboundTimestamp;

  if (elapsed >= 0 && elapsed < META_FREE_WINDOW_MS) {
    const remainingMs = META_FREE_WINDOW_MS - elapsed;
    const remainingMinutes = Math.floor(remainingMs / 60_000);
    return {
      isOpen: true,
      remainingMinutes,
      costStatus: 'FREE_0_USD',
      lastInboundTimestamp,
      expiresAtMs: lastInboundTimestamp + META_FREE_WINDOW_MS,
    };
  }

  return {
    isOpen: false,
    remainingMinutes: 0,
    costStatus: 'TEMPLATE_REQUIRED',
    lastInboundTimestamp,
    expiresAtMs: lastInboundTimestamp + META_FREE_WINDOW_MS,
  };
}

// =============================================================================
// 3. AI WELCOME & TRIAGE CLASSIFIER
// =============================================================================

/**
 * Deterministic classifier and response drafter for incoming customer messages.
 * Detects workspace target, customer intent, bank references, and duplicates.
 */
export function classifyAndDraftAiResponse(
  incomingText: string,
  deals: PipelineDeal[] = [],
  activeScope: WorkspaceScope = 'P2P_DESK',
  config?: Partial<OmnichannelIntegrationConfig>,
): AiTriageResult {
  const text = (incomingText || '').trim();
  const lower = text.toLowerCase();

  // 1. Target Scope Detection
  const p2pKeywords = [
    'usdt',
    'tasa',
    'cambio',
    'ves',
    'cop',
    'pago movil',
    'pago móvil',
    'pagomovil',
    'zinli',
    'zelle',
    'binance',
    'bsf',
    'bolivares',
    'bolívares',
    'pesos',
    'vender',
    'comprar',
    'cripto',
    'dolar',
    'dólar',
  ];

  const commercial360Keywords = [
    'presupuesto',
    'cotizacion',
    'cotización',
    'factura',
    'repuesto',
    'servicio',
    'mano de obra',
    'mantenimiento',
    'cuota',
    'cuotas',
    'pieza',
    'piezas',
    'proveedor',
    'reparacion',
    'reparación',
    'taller',
    'facturar',
  ];

  let p2pScore = 0;
  for (const kw of p2pKeywords) {
    if (lower.includes(kw)) p2pScore++;
  }

  let scope360Score = 0;
  for (const kw of commercial360Keywords) {
    if (lower.includes(kw)) scope360Score++;
  }

  let targetScope: WorkspaceScope = activeScope;
  if (scope360Score > p2pScore) {
    targetScope = 'FINANCE_360';
  } else if (p2pScore > scope360Score) {
    targetScope = 'P2P_DESK';
  }

  // 2. Reference & Payment Proof Detection
  let extractedRef: string | undefined;
  const refPrefixMatch = text.match(
    /(?:ref|referencia|transf|operaci[oó]n|num|nro|#)\s*[:#.-]?\s*([A-Za-z0-9]{4,16})/i,
  );
  if (refPrefixMatch && refPrefixMatch[1]) {
    extractedRef = normalizeBankReference(refPrefixMatch[1]);
  } else {
    // Look for isolated numeric sequence between 6 and 12 digits (avoiding 4-digit years like 2024/2025/2026)
    const digitsMatch = text.match(/\b(?!(?:202[4-9]|19\d{2})\b)\d{6,12}\b/);
    if (digitsMatch) {
      extractedRef = normalizeBankReference(digitsMatch[0]);
    }
  }

  // 3. Amount Extraction (if present)
  let extractedAmount: number | undefined;
  const amountMatch = text.match(
    /(?:monto|total|por|\$|bs\.?|cop)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)\s*(?:usdt|usd|\$|bs|ves|cop)?/i,
  );
  if (amountMatch && amountMatch[1]) {
    const rawNum = amountMatch[1].replace(/\./g, '').replace(',', '.');
    const parsed = parseFloat(rawNum);
    if (Number.isFinite(parsed) && parsed > 0 && parsed !== Number(extractedRef)) {
      extractedAmount = parsed;
    }
  }

  // 4. Intent Classification
  const paymentProofKeywords = [
    'pague',
    'pagué',
    'transferi',
    'transferí',
    'comprobante',
    'captura',
    'pago listo',
    'ya te pague',
    'ya te pagué',
    'aqui esta',
    'aquí está',
    'listo el pago',
    'abone',
    'aboné',
  ];
  const hasProofKeyword = paymentProofKeywords.some((kw) => lower.includes(kw));

  let detectedIntent: OmnichannelIntent = 'GENERAL';
  if (hasProofKeyword || (extractedRef && extractedRef.length >= 4)) {
    detectedIntent = 'PAYMENT_PROOF';
  } else if (scope360Score > 0 || lower.includes('presupuesto') || lower.includes('cotiz')) {
    detectedIntent = 'QUOTE_INVOICE_REQUEST';
  } else if (p2pScore > 0) {
    detectedIntent = 'P2P_EXCHANGE';
  }

  // 5. Duplicate Check
  let isDuplicateReference = false;
  let collidingDealId: string | undefined;
  if (extractedRef && extractedRef.length >= 4) {
    const collision = verifyReferenceCollision(deals, extractedRef);
    if (collision.isDuplicate && collision.existingDeal) {
      isDuplicateReference = true;
      collidingDealId = collision.existingDeal.id;
    }
  }

  // 6. Suggested Reply & Kanban Action
  const businessName = config?.businessDisplayName ? `${config.businessDisplayName}` : '';
  const prefix = businessName ? `Hola! Te saluda ${businessName}. ` : '¡Hola! ';
  let suggestedReplyText = '';
  let recommendedKanbanAction: AiTriageResult['recommendedKanbanAction'] = 'NONE';

  if (detectedIntent === 'PAYMENT_PROOF') {
    if (isDuplicateReference) {
      suggestedReplyText = `⚠️ ${prefix}Detectamos la referencia ${extractedRef}. Sin embargo, figura asociada a una operación previa en nuestro sistema. Por favor confirma si es un reenvío para verificarla con tesorería.`;
      recommendedKanbanAction = 'NONE';
    } else {
      suggestedReplyText = `✅ ${prefix}Comprobante recibido con ref ${extractedRef || 'en proceso'}. Nuestro operador está verificando la acreditación bancaria para proceder con la liberación inmediata.`;
      recommendedKanbanAction = 'ATTACH_PAYMENT_REF';
    }
  } else if (detectedIntent === 'P2P_EXCHANGE') {
    const customP2p = config?.welcomeTemplateP2p?.trim();
    suggestedReplyText = customP2p
      ? customP2p
      : `${prefix}Con gusto te atendemos en nuestra mesa P2P. Por favor indícanos el monto en USDT o Fiat que deseas operar y tu método de pago preferido (Pago Móvil, Transferencia, Zinli, Zelle).`;
    recommendedKanbanAction = 'CREATE_P2P_DEAL';
  } else if (detectedIntent === 'QUOTE_INVOICE_REQUEST') {
    const custom360 = config?.welcomeTemplate360?.trim();
    suggestedReplyText = custom360
      ? custom360
      : `${prefix}Con gusto gestionamos tu cotización o factura comercial. Por favor indícanos los ítems, productos o servicios requeridos para emitirte la propuesta formal al instante.`;
    recommendedKanbanAction = 'CREATE_360_QUOTE_DEAL';
  } else {
    suggestedReplyText = `${prefix}¿En qué podemos ayudarte hoy? (Operaciones P2P / Presupuestos y Servicios comerciales).`;
    recommendedKanbanAction = 'NONE';
  }

  const confidence =
    detectedIntent === 'PAYMENT_PROOF'
      ? 0.95
      : detectedIntent === 'P2P_EXCHANGE' || detectedIntent === 'QUOTE_INVOICE_REQUEST'
        ? 0.88
        : 0.65;

  return {
    targetScope,
    detectedIntent,
    extractedReferenceId: extractedRef,
    extractedAmount,
    isDuplicateReference,
    collidingDealId,
    suggestedReplyText,
    recommendedKanbanAction,
    confidence,
  };
}

// =============================================================================
// 4. ANTI-FRICTION "EASY COPY & PASTE" BANK BUBBLE FORMATTER
// =============================================================================

/**
 * Produces clean, separate copyable bubbles and a formatted single text block
 * so mobile users on WhatsApp/Instagram can copy raw bank details with 1 tap.
 */
export function buildCopyableBankBubbles(
  bank: CrmBankAccount,
  totalFiatAmount?: number,
): CopyableBankBubbles {
  const details = bank.holderDetailsText || '';

  // Header
  const firstLine = details.split(/[\n,;-]/)[0]?.trim() || '';
  const headerBubble = `🏦 ${bank.bankName} (${bank.currency})${firstLine ? ` - ${firstLine}` : ''}`;

  // Document ID (pure V/E/J/G/NIT + numbers, no spaces or hyphens)
  let docIdBubble = '';
  const docMatch = details.match(/\b([VEJGvejgP][-:\s]?[0-9]{6,10}(?:[-][0-9])?)\b/i);
  if (docMatch && docMatch[1]) {
    docIdBubble = docMatch[1].toUpperCase().replace(/[-:\s]/g, '');
  } else {
    // Fallback: search for bare 7-9 digits
    const bareNumMatch = details.match(/\b\d{7,9}\b/);
    docIdBubble = bareNumMatch ? `V${bareNumMatch[0]}` : details.trim();
  }

  // Account / Phone (pure digits without dashes, spaces or labels)
  let accountOrPhoneBubble = '';
  const fullAccountMatch = details.match(/\b\d{20}\b/);
  const phoneMatch = details.match(/\b(?:04|02|584|573)\d{8,9}\b/);

  if (phoneMatch) {
    accountOrPhoneBubble = phoneMatch[0];
  } else if (fullAccountMatch) {
    accountOrPhoneBubble = fullAccountMatch[0];
  } else {
    // Search general 10-20 digit block
    const generalDigits = details.match(/\b\d{10,20}\b/);
    if (generalDigits) {
      accountOrPhoneBubble = generalDigits[0];
    } else {
      accountOrPhoneBubble = details.replace(/[^0-9]/g, '') || details.trim();
    }
  }

  // Amount bubble
  let amountBubble: string | undefined;
  if (totalFiatAmount != null && Number.isFinite(totalFiatAmount) && totalFiatAmount > 0) {
    amountBubble = totalFiatAmount.toFixed(2);
  }

  const bubbles = [headerBubble, docIdBubble, accountOrPhoneBubble];
  if (amountBubble) {
    bubbles.push(amountBubble);
  }

  const formattedBlock = [
    `🏦 *DATOS DE PAGO - ${bank.bankName} (${bank.currency})*`,
    `👤 *Titular:* ${details.split('\n')[0] || 'Registrado'}`,
    `🆔 *Cédula/RIF:* \`${docIdBubble}\``,
    `📲 *Cuenta / Pago Móvil:* \`${accountOrPhoneBubble}\``,
    ...(amountBubble ? [`💵 *Monto Exacto:* \`${amountBubble} ${bank.currency}\``] : []),
    `\n_Copia cada dato con 1 toque en tu app bancaria._`,
  ].join('\n');

  return {
    headerBubble,
    docIdBubble,
    accountOrPhoneBubble,
    amountBubble,
    bubbles,
    formattedBlock,
  };
}

// =============================================================================
// 5. INVOICE, QUOTE & RECEIPT STUDIO ENGINE
// =============================================================================

export interface BillingTotalsResult {
  subtotalUsdt: number;
  discountUsdt: number;
  taxOrFeeUsdt: number;
  totalUsdt: number;
  totalFiat: number;
}

/**
 * Calculates billing totals with finite number guards and zero NaN.
 */
export function calculateBillingDocumentTotals(
  items: BillingLineItem[],
  discountUsdt: number = 0,
  taxPct: number = 0,
  exchangeRate: number = 1,
): BillingTotalsResult {
  const safeItems = Array.isArray(items) ? items : [];

  const subtotalUsdt = safeItems.reduce((acc, it) => {
    const q = Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 0;
    const p = Number.isFinite(it.unitPriceUsdt) && it.unitPriceUsdt > 0 ? it.unitPriceUsdt : 0;
    return acc + q * p;
  }, 0);

  const safeDiscount =
    Number.isFinite(discountUsdt) && discountUsdt > 0
      ? Math.min(discountUsdt, subtotalUsdt)
      : 0;

  const baseAfterDiscount = Math.max(0, subtotalUsdt - safeDiscount);

  const safeTaxPct = Number.isFinite(taxPct) && taxPct > 0 ? taxPct : 0;
  const taxOrFeeUsdt = (baseAfterDiscount * safeTaxPct) / 100;

  const totalUsdt = Math.round((baseAfterDiscount + taxOrFeeUsdt) * 100) / 100;

  const safeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  const totalFiat = Math.round(totalUsdt * safeRate * 100) / 100;

  return {
    subtotalUsdt: Math.round(subtotalUsdt * 100) / 100,
    discountUsdt: Math.round(safeDiscount * 100) / 100,
    taxOrFeeUsdt: Math.round(taxOrFeeUsdt * 100) / 100,
    totalUsdt,
    totalFiat,
  };
}

/**
 * Formats a billing document into a clean, ready-to-send WhatsApp / Instagram message.
 */
export function formatDocumentForMessaging(
  doc: CrmBillingDocument,
  bankAccount?: CrmBankAccount,
): string {
  const docTypeLabels: Record<CrmDocumentType, string> = {
    PRESUPUESTO_QUOTE: 'PRESUPUESTO / COTIZACIÓN',
    FACTURA_INVOICE: 'FACTURA COMERCIAL',
    COMPROBANTE_P2P: 'COMPROBANTE DE LIQUIDACIÓN P2P',
  };

  const lines: string[] = [
    `🧾 *${docTypeLabels[doc.docType] || 'DOCUMENTO COMERCIAL'}*`,
    `📄 *Nº:* ${doc.docNumber} | *Fecha:* ${new Date(doc.createdAt).toLocaleDateString('es-ES')}`,
    `👤 *Cliente:* ${doc.contactName}${doc.contactDocId ? ` (${doc.contactDocId})` : ''}`,
    '----------------------------------------',
    '*DETALLE DE ÍTEMS:*',
  ];

  for (const item of doc.items || []) {
    const totalItem = (item.quantity * item.unitPriceUsdt).toFixed(2);
    lines.push(`• ${item.quantity}x ${item.description} - $${totalItem} USDT`);
  }

  lines.push('----------------------------------------');
  lines.push(`Subtotal: $${doc.subtotalUsdt.toFixed(2)} USDT`);
  if (doc.discountUsdt > 0) {
    lines.push(`Descuento: -$${doc.discountUsdt.toFixed(2)} USDT`);
  }
  if (doc.taxOrFeeUsdt > 0) {
    lines.push(`Impuesto/Comisión: +$${doc.taxOrFeeUsdt.toFixed(2)} USDT`);
  }
  lines.push(`*TOTAL A PAGAR: $${doc.totalUsdt.toFixed(2)} USDT*`);

  if (doc.fiatCurrency && doc.exchangeRate > 0 && doc.totalFiat > 0) {
    lines.push(
      `*TOTAL EN ${doc.fiatCurrency}: ${doc.totalFiat.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${doc.fiatCurrency}* (Tasa: ${doc.exchangeRate.toFixed(4)})`,
    );
  }

  if (doc.bankReferenceId) {
    lines.push(`🔖 *Ref Bancaria:* \`${doc.bankReferenceId}\``);
  }

  if (bankAccount) {
    const bubbles = buildCopyableBankBubbles(bankAccount, doc.totalFiat);
    lines.push('');
    lines.push(bubbles.formattedBlock);
  } else if (doc.paymentInstructionsText) {
    lines.push('');
    lines.push(`*INSTRUCCIONES DE PAGO:*\n${doc.paymentInstructionsText}`);
  }

  return lines.join('\n');
}

// =============================================================================
// 6. WHATSAPP DIRECT URL BUILDER
// =============================================================================

/**
 * Normalizes phone numbers for Venezuela (+58), Colombia (+57), etc.,
 * and creates a direct wa.me link for immediate $0-cost dispatch.
 */
export function buildWhatsAppDirectUrl(phone: string, text: string = ''): string {
  let clean = (phone || '').replace(/[^0-9]/g, '');

  // Normalize Venezuela numbers: 04141234567 -> 584141234567
  if (/^04[12][246]\d{7}$/.test(clean)) {
    clean = '58' + clean.slice(1);
  } else if (/^4[12][246]\d{7}$/.test(clean)) {
    clean = '58' + clean;
  }
  // Normalize Colombia numbers: 3001234567 -> 573001234567
  else if (/^3[0-9]{9}$/.test(clean)) {
    clean = '57' + clean;
  }

  const encoded = encodeURIComponent(text || '');
  return `https://wa.me/${clean}${encoded ? `?text=${encoded}` : ''}`;
}

// =============================================================================
// 7. GEMINI FLASH MULTIMODAL OCR PAYLOAD BUILDER & PARSER
// =============================================================================

/**
 * Prepares the REST payload for Gemini Flash multimodal bank receipt extraction.
 */
export function buildGeminiMultimodalOcrPayload(
  base64Image: string,
  mimeType: string = 'image/png',
): object {
  const cleanBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  return {
    contents: [
      {
        parts: [
          {
            text:
              'Analyze this bank transfer receipt or payment confirmation screenshot. ' +
              'Extract the following structured JSON with exact values: ' +
              '{"bank": string or null, "reference": string or null (digits of reference number), ' +
              '"amount": number or null, "currency": "VES"|"COP"|"USD" or null, "date": string or null, "rawNotes": string}. ' +
              'Respond ONLY with valid JSON.',
          },
          {
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };
}

/**
 * Parses Gemini Flash OCR output safely into typed Bank OCR fields.
 */
export function parseGeminiOcrResponse(rawTextOrJson: unknown): GeminiOcrParsedResult {
  let candidateText = '';

  if (typeof rawTextOrJson === 'string') {
    candidateText = rawTextOrJson;
  } else if (rawTextOrJson && typeof rawTextOrJson === 'object') {
    const rawObj = rawTextOrJson as Record<string, unknown>;
    const candidates = rawObj['candidates'] as Array<Record<string, unknown>> | undefined;
    if (candidates && candidates.length > 0) {
      const content = candidates[0]['content'] as Record<string, unknown> | undefined;
      const parts = content?.['parts'] as Array<Record<string, unknown>> | undefined;
      if (parts && parts.length > 0 && typeof parts[0]['text'] === 'string') {
        candidateText = parts[0]['text'];
      }
    }
  }

  // Strip Markdown code fences if present
  let cleanJson = candidateText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleanJson);
    return {
      bank: parsed.bank ? String(parsed.bank) : null,
      reference: parsed.reference ? normalizeBankReference(String(parsed.reference)) : null,
      amount: Number.isFinite(parsed.amount) ? Number(parsed.amount) : null,
      currency:
        parsed.currency === 'VES' || parsed.currency === 'COP' || parsed.currency === 'USD'
          ? (parsed.currency as FiatCurrency)
          : null,
      date: parsed.date ? String(parsed.date) : null,
      rawNotes: parsed.rawNotes ? String(parsed.rawNotes) : cleanJson,
    };
  } catch {
    return {
      bank: null,
      reference: null,
      amount: null,
      currency: null,
      date: null,
      rawNotes: candidateText || 'Failed to parse JSON response',
    };
  }
}
