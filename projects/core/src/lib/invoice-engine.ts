/**
 * Pure Banking Compliance & Batch Invoice Engine.
 * Transforms transactional records (Binance P2P CSV and internal operation logs)
 * into structured corporate invoices for legitimate intangible services (Marketing, IT, Consulting).
 * Strictly sanitizes and purges all cryptocurrency references to ensure compliance with
 * neobanks and international banking AML standards.
 * Framework-agnostic, zero external dependencies.
 */

import { roundMoney } from './money';
import { type Operation } from './log';

export type TicketTier = 'LOW' | 'MID' | 'HIGH';

export interface ServiceConceptTemplate {
  id: string;
  category: string;
  serviceTitle: string;
  defaultDescription: string;
  minAmountUsd: number;
  maxAmountUsd: number;
}

export const COMPLIANT_SERVICE_CONCEPTS: readonly ServiceConceptTemplate[] = [
  {
    id: 'DIGITAL_MARKETING',
    category: 'Marketing & Publicidad',
    serviceTitle: 'Consultoría en Estrategia de Marketing Digital',
    defaultDescription: 'Planificación de pauta digital, optimización de audiencia y gestión de presencia en medios digitales.',
    minAmountUsd: 10,
    maxAmountUsd: 500,
  },
  {
    id: 'IT_INFRASTRUCTURE',
    category: 'Tecnología & Redes',
    serviceTitle: 'Servicios de Administración y Soporte de Redes',
    defaultDescription: 'Monitoreo de disponibilidad, mantenimiento de infraestructura en la nube y soporte técnico remoto.',
    minAmountUsd: 50,
    maxAmountUsd: 1200,
  },
  {
    id: 'SOFTWARE_DEV',
    category: 'Desarrollo de Software',
    serviceTitle: 'Desarrollo y Mantenimiento Web Especializado',
    defaultDescription: 'Implementación de componentes web, optimización de velocidad de carga y pruebas de integración de software.',
    minAmountUsd: 80,
    maxAmountUsd: 3000,
  },
  {
    id: 'BUSINESS_ADVISORY',
    category: 'Consultoría Empresarial',
    serviceTitle: 'Asesoría y Planificación de Gestión Comercial',
    defaultDescription: 'Elaboración de manuales operativos, diagnóstico de rentabilidad y asesoría estratégica de procesos.',
    minAmountUsd: 40,
    maxAmountUsd: 1500,
  },
  {
    id: 'DATA_ANALYTICS',
    category: 'Análisis de Datos',
    serviceTitle: 'Servicios de Procesamiento y Análisis de Datos',
    defaultDescription: 'Normalización de bases de datos, generación de reportes ejecutivos e indicadores clave de rendimiento (KPIs).',
    minAmountUsd: 60,
    maxAmountUsd: 2000,
  },
];

export type InvoiceTemplateType = 'NEOBANK_USD' | 'LOCAL_VES' | 'CORPORATE_BRANDED';

export interface IssuerProfile {
  businessName: string;
  taxId: string; // e.g. RIF, NIT, EIN, RFC
  address: string;
  email?: string;
  phone?: string;
  website?: string;
  logoDataUrl?: string; // Optional base64/dataURL for corporate header
}

export interface ClientProfile {
  name: string;
  taxId?: string;
  email?: string;
  address?: string;
  country?: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface GeneratedInvoice {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;   // YYYY-MM-DD
  issuer: IssuerProfile;
  client: ClientProfile;
  conceptCategory: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRatePct: number;
  taxAmount: number;
  total: number;
  currency: string;
  ticketTier: TicketTier;
  referenceCode: string; // Masked sanitized transaction ref
  paymentMethodOrBank?: string; // e.g. Banesco, Pago Móvil, Zelle
  notes: string;
  templateType: InvoiceTemplateType;
}

export interface NormalizedTransactionRow {
  sourceId: string;
  dateIso: string;
  type: 'BUY' | 'SELL';
  asset: string;
  fiatCurrency: string;
  fiatAmount: number;
  price: number;
  cryptoAmount: number;
  counterparty: string;
  bankName: string;
  rawStatus: string;
}

export interface InvoiceBatchOptions {
  invoicePrefix?: string;
  startNumber?: number;
  currencyOverride?: string;
  defaultTaxRatePct?: number; // e.g. 0% for export of services
  dueDaysOffset?: number;
  customServiceConceptId?: string;
  templateType?: InvoiceTemplateType;
}

/** Words strictly banned from invoices to avoid AML / crypto keyword flags */
const BANNED_CRYPTO_KEYWORDS = [
  /\bcrypto\b/gi,
  /\bcripto\b/gi,
  /\busdt\b/gi,
  /\bbtc\b/gi,
  /\bbitcoin\b/gi,
  /\beth\b/gi,
  /\bethereum\b/gi,
  /\bbinance\b/gi,
  /\bp2p\b/gi,
  /\btether\b/gi,
  /\barbitraje\b/gi,
  /\barbitrage\b/gi,
  /\bbybit\b/gi,
];

/**
 * Purges forbidden terms from notes and references.
 */
export function sanitizeComplianceText(input: string): string {
  if (!input) return '';
  let sanitized = input;
  for (const regex of BANNED_CRYPTO_KEYWORDS) {
    sanitized = sanitized.replace(regex, 'Servicio');
  }
  return sanitized.trim();
}

/**
 * Classifies ticket tier based on fiat/USD equivalent amount.
 */
export function classifyTicketTier(amount: number, currency: string): TicketTier {
  // Approximate threshold mapping
  let usdEquivalent = amount;
  if (currency === 'VES' && amount > 2000) {
    usdEquivalent = amount / 70; // approximate reference normalization for categorization
  } else if (currency === 'COP' && amount > 100000) {
    usdEquivalent = amount / 4000;
  }

  if (usdEquivalent < 80) return 'LOW';
  if (usdEquivalent <= 300) return 'MID';
  return 'HIGH';
}

/**
 * Parses raw CSV content exported from Binance P2P or system operations log.
 * Handles both Spanish and English header formats, quotes, and commas inside amounts.
 */
export function parseBinanceP2pCsv(csvContent: string): NormalizedTransactionRow[] {
  if (!csvContent || typeof csvContent !== 'string') return [];

  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map((h) => h.toLowerCase().trim());

  // Detect column mapping based on standard Binance CSV exports
  // Spanish: Fecha/Hora, Tipo, Par/Activo, Cantidad, Tasa Bs, Total Bs, Banco, Contraparte, Estado
  // English: Order Number, Order Type, Asset Type, Fiat Type, Total Price, Unit Price, Quantity, Counterparty, Status, Create Time
  const dateIdx = headers.findIndex((h) => h.includes('fecha') || h.includes('time') || h.includes('date'));
  const typeIdx = headers.findIndex((h) => h.includes('tipo') || h.includes('type'));
  const assetIdx = headers.findIndex((h) => h.includes('par') || h.includes('asset') || h.includes('moneda'));
  const fiatTotalIdx = headers.findIndex((h) => h.includes('total') || h.includes('fiat amount'));
  const rateIdx = headers.findIndex((h) => h.includes('tasa') || h.includes('price') || h.includes('unit price'));
  const cryptoAmountIdx = headers.findIndex((h) => h.includes('cantidad') || h.includes('quantity') || h.includes('amount'));
  const counterpartyIdx = headers.findIndex((h) => h.includes('contraparte') || h.includes('counterparty') || h.includes('usuario'));
  const bankIdx = headers.findIndex((h) => h.includes('banco') || h.includes('bank') || h.includes('método') || h.includes('method'));
  const statusIdx = headers.findIndex((h) => h.includes('estado') || h.includes('status'));
  const orderNoIdx = headers.findIndex((h) => h.includes('orden') || h.includes('order number') || h.includes('id'));

  const parsedRows: NormalizedTransactionRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = parseCsvLine(lines[i]);
    if (rawCols.length < 3) continue;

    const rawType = (rawCols[typeIdx] || '').toUpperCase();
    const isSell = rawType.includes('VENTA') || rawType.includes('SELL');
    const isBuy = rawType.includes('COMPRA') || rawType.includes('BUY');
    if (!isSell && !isBuy) continue;

    const totalStr = rawCols[fiatTotalIdx] || '0';
    const cleanTotal = parseNumericValue(totalStr);

    const priceStr = rawCols[rateIdx] || '0';
    const cleanPrice = parseNumericValue(priceStr);

    const cryptoStr = rawCols[cryptoAmountIdx] || '0';
    const cleanCrypto = parseNumericValue(cryptoStr);

    const rawDate = rawCols[dateIdx] || new Date().toISOString();
    const counterparty = (rawCols[counterpartyIdx] || 'Cliente Comercial').replace(/^@/, '').trim();
    const bankName = rawCols[bankIdx] || 'Transferencia Bancaria';
    const asset = rawCols[assetIdx] || 'USD';
    const status = rawCols[statusIdx] || 'COMPLETED';
    const orderNo = rawCols[orderNoIdx] || `ORD-${Date.now().toString(36)}-${i}`;

    // Detect fiat currency
    let fiatCurrency = 'USD';
    if (headerLine.toLowerCase().includes('bs') || rawCols.some((c) => c.toLowerCase().includes('ves') || c.toLowerCase().includes('bs'))) {
      fiatCurrency = 'VES';
    } else if (rawCols.some((c) => c.toLowerCase().includes('cop'))) {
      fiatCurrency = 'COP';
    } else if (rawCols.some((c) => c.toLowerCase().includes('eur'))) {
      fiatCurrency = 'EUR';
    }

    parsedRows.push({
      sourceId: orderNo,
      dateIso: normalizeDate(rawDate),
      type: isSell ? 'SELL' : 'BUY',
      asset,
      fiatCurrency,
      fiatAmount: roundMoney(cleanTotal, 2),
      price: cleanPrice,
      cryptoAmount: roundMoney(cleanCrypto, 4),
      counterparty,
      bankName,
      rawStatus: status,
    });
  }

  return parsedRows;
}

/**
 * Generates an array of formal compliant invoices from normalized rows.
 * Only SELL operations (incoming fiat transfers) are converted into invoices.
 */
export function generateInvoicesFromTransactions(
  transactions: readonly NormalizedTransactionRow[],
  issuer: IssuerProfile,
  options: InvoiceBatchOptions = {},
): GeneratedInvoice[] {
  const prefix = options.invoicePrefix ?? 'FAC';
  let counter = options.startNumber ?? 1001;
  const taxRate = options.defaultTaxRatePct ?? 0;
  const dueDays = options.dueDaysOffset ?? 7;

  // Filter ONLY sell orders (where operator sold and received fiat in their bank account)
  const sellOrders = transactions.filter((t) => t.type === 'SELL' && t.fiatAmount > 0);

  const invoices: GeneratedInvoice[] = [];

  for (let index = 0; index < sellOrders.length; index++) {
    const tx = sellOrders[index];
    const invoiceNumber = `${prefix}-${new Date(tx.dateIso).getFullYear()}-${counter.toString().padStart(4, '0')}`;
    counter++;

    // Determine template type (defaults to LOCAL_VES if fiat is VES, otherwise NEOBANK_USD)
    const templateType: InvoiceTemplateType =
      options.templateType ?? (tx.fiatCurrency === 'VES' ? 'LOCAL_VES' : 'NEOBANK_USD');

    // Deterministically pick a service concept rotation based on index and amount
    const concept = selectCompliantConcept(tx.fiatAmount, options.customServiceConceptId, index);

    let currency: string;
    let subtotal: number;
    let paymentMethod: string;
    let notes: string;
    let referenceCode: string;

    const rawBank = (tx.bankName || 'BNC').trim();
    const cleanBank = sanitizeComplianceText(rawBank).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'BNK';
    const cleanSuffix = tx.sourceId ? tx.sourceId.replace(/[^a-zA-Z0-9]/g, '').slice(-6) : '000000';

    if (templateType === 'NEOBANK_USD') {
      currency = options.currencyOverride || (tx.fiatCurrency === 'EUR' ? 'EUR' : 'USD');
      // For neobanks, if original tx was in VES, use cryptoAmount (USDT -> USD 1:1) or divide by price
      if (tx.fiatCurrency === 'VES') {
        subtotal = tx.cryptoAmount > 0 ? tx.cryptoAmount : (tx.price > 0 ? roundMoney(tx.fiatAmount / tx.price, 2) : tx.fiatAmount);
      } else {
        subtotal = roundMoney(tx.fiatAmount, 2);
      }
      paymentMethod = tx.bankName ? `Transferencia Neobanco (${tx.bankName})` : 'Compensación Electrónica Neobanco';
      referenceCode = `REF-NEO-${cleanBank}-${cleanSuffix}`;
      notes = 'Factura mercantil internacional emitida por concepto de servicios profesionales intangibles y consultoría digital remota. Pago recibido vía compensación electrónica internacional / neobanco.';
    } else if (templateType === 'LOCAL_VES') {
      currency = options.currencyOverride || 'VES';
      if (tx.fiatCurrency !== 'VES') {
        subtotal = roundMoney(tx.cryptoAmount * (tx.price || 1), 2);
      } else {
        subtotal = roundMoney(tx.fiatAmount, 2);
      }
      paymentMethod = tx.bankName ? `Pago Móvil / Liquidación Bancaria (${tx.bankName})` : 'Pago Móvil / Transferencia Bancaria';
      referenceCode = `REF-PM-${cleanBank}-${cleanSuffix}`;
      notes = 'Factura mercantil de servicios profesionales. Cancelado mediante liquidación bancaria electrónica / Pago Móvil nacional.';
    } else {
      // CORPORATE_BRANDED
      currency = options.currencyOverride || tx.fiatCurrency || 'USD';
      subtotal = roundMoney(tx.fiatAmount > 0 ? tx.fiatAmount : tx.cryptoAmount, 2);
      paymentMethod = tx.bankName ? `Transferencia Corporativa (${tx.bankName})` : 'Transferencia Bancaria Directa';
      referenceCode = `REF-CORP-${cleanBank}-${cleanSuffix}`;
      notes = 'Factura fiscal corporativa para justificación contable y auditoría de cumplimiento comercial. Contraparte verificada y fondos de curso legal.';
    }

    const tier = classifyTicketTier(subtotal, currency);
    const taxAmount = taxRate > 0 ? roundMoney((subtotal * taxRate) / 100, 2) : 0;
    const total = roundMoney(subtotal + taxAmount, 2);

    const issueDate = tx.dateIso.split('T')[0];
    const dueDateObj = new Date(tx.dateIso);
    dueDateObj.setDate(dueDateObj.getDate() + dueDays);
    const dueDate = dueDateObj.toISOString().split('T')[0];

    invoices.push({
      invoiceNumber,
      issueDate,
      dueDate,
      issuer,
      client: {
        name: tx.counterparty || 'Cliente Corporativo',
        taxId: 'N/A',
        country: templateType === 'NEOBANK_USD' ? 'US' : 'VE',
      },
      conceptCategory: concept.category,
      items: [
        {
          description: `${concept.serviceTitle} — ${concept.defaultDescription}`,
          quantity: 1,
          unitPrice: subtotal,
          total: subtotal,
        },
      ],
      subtotal,
      taxRatePct: taxRate,
      taxAmount,
      total,
      currency,
      ticketTier: tier,
      referenceCode,
      paymentMethodOrBank: paymentMethod,
      notes,
      templateType,
    });
  }

  return invoices;
}

/**
 * Adapts internal app Operation[] records to normalized transactions and produces invoices.
 */
export function generateInvoicesFromAppOperations(
  operations: readonly Operation[],
  issuer: IssuerProfile,
  options: InvoiceBatchOptions = {},
): GeneratedInvoice[] {
  const normalized: NormalizedTransactionRow[] = operations.map((op) => ({
    sourceId: op.id,
    dateIso: op.timestamp || new Date().toISOString(),
    type: op.type === 'sell' ? 'SELL' : 'BUY',
    asset: op.pair || 'USDT',
    fiatCurrency: 'VES',
    fiatAmount: roundMoney(op.vesAmount, 2),
    price: op.price,
    cryptoAmount: roundMoney(op.usdtAmount, 4),
    counterparty: op.merchantNote ? op.merchantNote.slice(0, 30) : 'Cliente Registrado',
    bankName: op.bankAccountId || 'Banco Registrado',
    rawStatus: op.errorFree ? 'VERIFIED' : 'COMPLETED',
  }));

  return generateInvoicesFromTransactions(normalized, issuer, options);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectCompliantConcept(amount: number, requestedId?: string, index = 0): ServiceConceptTemplate {
  if (requestedId) {
    const found = COMPLIANT_SERVICE_CONCEPTS.find((c) => c.id === requestedId);
    if (found) return found;
  }
  // Rotate through compliant concepts
  const availableIndex = index % COMPLIANT_SERVICE_CONCEPTS.length;
  return COMPLIANT_SERVICE_CONCEPTS[availableIndex];
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseNumericValue(val: string): number {
  if (!val) return 0;
  // Strip quotes and currency tags
  const clean = val.replace(/["$Bs,]/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function normalizeDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {
    // fallback
  }
  return new Date().toISOString();
}
