import { Injectable, inject } from '@angular/core';
import { StorageService } from '../storage';
import { CotizaveService } from '../cotizave.service';
import { SecureVaultService } from '../secure-vault.service';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
  PaymentChannel,
} from '../models/finance-360.models';

export const FINANCIAL_PILLAR = {
  EXPENSE: 'expense',
  INCOME: 'income',
  LIABILITY: 'liability',
} as const;

export type FinancialPillar = (typeof FINANCIAL_PILLAR)[keyof typeof FINANCIAL_PILLAR];

export interface ParsedFinancialDocument {
  title: string;
  amount: number;
  currency: CurrencyCode;
  bcvRateApplied: number;
  scope: FinanceScope;
  pillar: FinancialPillar;
  expenseCategory?: ExpenseCategory;
  incomeCategory?: IncomeCategory;
  channel: PaymentChannel;
  referenceNumber?: string;
  entityName?: string;
  date: string; // YYYY-MM-DD
  isCashea: boolean;
  casheaInstallmentNumber?: number;
  notes?: string;
  rawText?: string;
  confidence: number;
}

interface InlineDataPayload {
  mimeType: string;
  data: string;
}

interface ElectronAiAnalyzeRequest {
  prompt: string;
  inlineData?: InlineDataPayload;
  temperature?: number;
  responseMimeType?: string;
}

interface ElectronAiAnalyzeResponse {
  success?: boolean;
  text?: string;
  rawText?: string;
  output?: string;
  data?: unknown;
  error?: string;
}

interface Finance360ElectronBridge {
  aiAnalyze?: (
    req: ElectronAiAnalyzeRequest,
  ) => Promise<ElectronAiAnalyzeResponse | string>;
}

interface GeminiTextPart {
  text?: string;
}

interface GeminiCandidateContent {
  parts?: GeminiTextPart[];
}

interface GeminiCandidate {
  content?: GeminiCandidateContent;
}

interface GeminiApiResponse {
  candidates?: GeminiCandidate[];
}

interface RawParsedAiDocument {
  title?: unknown;
  amount?: unknown;
  currency?: unknown;
  scope?: unknown;
  pillar?: unknown;
  expenseCategory?: unknown;
  incomeCategory?: unknown;
  channel?: unknown;
  referenceNumber?: unknown;
  entityName?: unknown;
  date?: unknown;
  isCashea?: unknown;
  casheaInstallmentNumber?: unknown;
  notes?: unknown;
  confidence?: unknown;
}

interface ExtractedAmountMatch {
  amount: number;
  currencyHint?: CurrencyCode;
}

const VAULT_GEMINI_KEY = 'gemini_api_key';
const LEGACY_GEMINI_STORAGE_KEYS = ['p2p.gemini.apiKey', 'p2p.ai.key.gemini'] as const;

const CANDIDATE_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

const VALID_CURRENCIES: readonly CurrencyCode[] = ['USD', 'VES', 'USDT', 'EUR'];
const VALID_SCOPES: readonly FinanceScope[] = ['personal', 'business'];
const VALID_PILLARS: readonly FinancialPillar[] = ['expense', 'income', 'liability'];
const VALID_CHANNELS: readonly PaymentChannel[] = [
  'zelle',
  'bs_bank',
  'crypto',
  'cash',
  'receivable',
  'other',
];

const VET_OFFSET_MS = 4 * 60 * 60 * 1000;

function todayVetIso(): string {
  return new Date(Date.now() - VET_OFFSET_MS).toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getElectronFinance360Bridge(): Finance360ElectronBridge | null {
  if (typeof window === 'undefined') return null;
  const winRecord = window as unknown as Record<string, unknown>;
  const electronVal = winRecord['electron'];
  if (!isRecord(electronVal)) return null;
  const f360 = electronVal['finance360'];
  if (!isRecord(f360)) return null;
  return f360 as Finance360ElectronBridge;
}

function parseLocaleAmount(rawToken: string): number {
  const token = rawToken.trim();
  if (!token) return 0;

  const hasDot = token.includes('.');
  const hasComma = token.includes(',');

  if (hasDot && hasComma) {
    const lastDot = token.lastIndexOf('.');
    const lastComma = token.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Venezuelan / Spanish format: 1.500,50 -> 1500.50
      return Number.parseFloat(token.replace(/\./g, '').replace(',', '.')) || 0;
    }
    // US format: 1,250.50 -> 1250.50
    return Number.parseFloat(token.replace(/,/g, '')) || 0;
  }

  if (hasComma) {
    const parts = token.split(',');
    if (parts.length > 2) {
      return Number.parseFloat(parts.join('')) || 0;
    }
    const [intPart, fracPart] = parts;
    if (fracPart.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart)) {
      return Number.parseFloat(`${intPart}${fracPart}`) || 0;
    }
    return Number.parseFloat(`${intPart}.${fracPart}`) || 0;
  }

  if (hasDot) {
    const parts = token.split('.');
    if (parts.length > 2) {
      return Number.parseFloat(parts.join('')) || 0;
    }
    const [intPart, fracPart] = parts;
    if (fracPart.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart)) {
      return Number.parseFloat(`${intPart}${fracPart}`) || 0;
    }
    return Number.parseFloat(token) || 0;
  }

  return Number.parseFloat(token) || 0;
}

function mapCurrencySymbol(symbol: string): CurrencyCode {
  const lower = symbol.trim().toLowerCase();
  if (lower.includes('usdt') || lower.includes('tether')) return 'USDT';
  if (lower.includes('eur') || lower.includes('€')) return 'EUR';
  if (lower.includes('$') || lower.includes('usd') || lower.includes('dol') || lower.includes('dól')) {
    return 'USD';
  }
  return 'VES';
}

function extractAmountAndCurrency(text: string): ExtractedAmountMatch {
  // 1. Prefix currency symbol directly before number: "$12.50", "Bs. 1.500,50", "USD 1,250.50", "$25"
  const prefixMatch = text.match(
    /(us\$|\$|€|(?<![A-Za-z])(?:usdt|usd|bs\.?|ves|eur))\s*(\d+(?:[.,]\d+)*)/i,
  );
  if (prefixMatch) {
    return {
      amount: parseLocaleAmount(prefixMatch[2]),
      currencyHint: mapCurrencySymbol(prefixMatch[1]),
    };
  }

  // 2. Suffix currency symbol directly after number: "1.500,50 Bs", "25$", "25 dólares", "12.50 USD"
  const suffixMatch = text.match(
    /(\d+(?:[.,]\d+)*)\s*(usdt|tether|usd|us\$|\$|bs\.?|ves|bol[ií]vares|d[oó]lares|dolares|euros?|eur|€)(?![A-Za-z])/i,
  );
  if (suffixMatch) {
    return {
      amount: parseLocaleAmount(suffixMatch[1]),
      currencyHint: mapCurrencySymbol(suffixMatch[2]),
    };
  }

  // 3. Explicit monetary label: "Total: 1.500,50", "Monto 12.50"
  const labeledMatch = text.match(
    /(?:total(?:\s+pagado)?|monto|importe|subtotal|valor|a\s+pagar)[:\s]*(\d+(?:[.,]\d+)*)/i,
  );
  if (labeledMatch) {
    return { amount: parseLocaleAmount(labeledMatch[1]) };
  }

  // 4. Sanitized fallback: strip dates, references, IDs, phones, and Cashea installment indices
  const scrubbed = text
    .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    .replace(
      /(?:ref(?:erencia)?|comprobante|operaci[oó]n|nro\.?\s*ref(?:erencia)?)[:\s#-]*[A-Za-z0-9-]*\d[A-Za-z0-9-]*/gi,
      ' ',
    )
    .replace(/\b[VEJG]-?\d{6,10}(?:-\d)?\b/gi, ' ')
    .replace(/cuota\s*(?:n[°ºo.]?\s*|#\s*)?\d{1,2}(?:\s*(?:de|\/)\s*\d{1,2})?/gi, ' ')
    .replace(/\b\d{1,2}(?:ra|da|ta|va|na|er|°|º)\s*cuota\b/gi, ' ')
    .replace(/\b0?4(?:12|14|16|24|26)[-\s]?\d{7}\b/g, ' ');

  const fallbackMatch = scrubbed.match(
    /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)/,
  );
  if (fallbackMatch) {
    return { amount: parseLocaleAmount(fallbackMatch[1]) };
  }

  return { amount: 0 };
}

function stripJsonCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

@Injectable({ providedIn: 'root' })
export class FinanceAiIngestorService {
  private readonly storage = inject(StorageService);
  private readonly cotizaveService = inject(CotizaveService);
  private readonly secureVault = inject(SecureVaultService, { optional: true });

  private getCurrentBcvRate(): number {
    const rates = this.cotizaveService.ratesByMarket();
    const oficial = rates['oficial'];
    return oficial?.mid ?? oficial?.ask ?? 0;
  }

  private async resolveGeminiApiKey(): Promise<string> {
    if (this.secureVault) {
      const vaultKey = (await this.secureVault.getSecret(VAULT_GEMINI_KEY))?.trim() ?? '';
      if (vaultKey) {
        this.clearLegacyPlaintextKeys();
        return vaultKey;
      }

      const legacyKey = this.readLegacyPlaintextKey();
      if (legacyKey) {
        try {
          await this.secureVault.storeSecret(VAULT_GEMINI_KEY, legacyKey);
          this.clearLegacyPlaintextKeys();
        } catch (err: unknown) {
          console.warn('[FinanceAiIngestor] Failed to migrate Gemini key into SecureVault:', err);
        }
        return legacyKey;
      }
      return '';
    }

    return this.readLegacyPlaintextKey();
  }

  private readLegacyPlaintextKey(): string {
    for (const key of LEGACY_GEMINI_STORAGE_KEYS) {
      const candidate = this.storage.get<string>(key);
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return '';
  }

  private clearLegacyPlaintextKeys(): void {
    for (const key of LEGACY_GEMINI_STORAGE_KEYS) {
      if (this.storage.get<unknown>(key) !== null) {
        this.storage.remove(key);
      }
    }
  }

  private async invokeElectronAiProxy(
    bridge: Finance360ElectronBridge,
    prompt: string,
    inlineData: InlineDataPayload,
  ): Promise<RawParsedAiDocument | null> {
    if (!bridge.aiAnalyze) return null;

    try {
      const response = await bridge.aiAnalyze({
        prompt,
        inlineData,
        temperature: 0.1,
        responseMimeType: 'application/json',
      });

      if (typeof response === 'string') {
        const cleaned = stripJsonCodeFences(response);
        if (!cleaned) return null;
        const parsed: unknown = JSON.parse(cleaned);
        return isRecord(parsed) ? (parsed as RawParsedAiDocument) : null;
      }

      if (!response || typeof response !== 'object' || response.success === false) {
        return null;
      }

      if (isRecord(response.data)) {
        return response.data as RawParsedAiDocument;
      }

      const rawText =
        typeof response.text === 'string'
          ? response.text
          : typeof response.rawText === 'string'
            ? response.rawText
            : typeof response.output === 'string'
              ? response.output
              : '';

      const cleaned = stripJsonCodeFences(rawText);
      if (!cleaned) return null;
      const parsed: unknown = JSON.parse(cleaned);
      return isRecord(parsed) ? (parsed as RawParsedAiDocument) : null;
    } catch (err: unknown) {
      console.warn('[FinanceAiIngestor] Electron aiAnalyze proxy failed:', err);
      return null;
    }
  }

  private async invokeGeminiDirect(
    apiKey: string,
    prompt: string,
    inlineData: InlineDataPayload,
  ): Promise<RawParsedAiDocument | null> {
    for (const model of CANDIDATE_GEMINI_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }, { inlineData }],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (!res.ok) continue;

        const json = (await res.json()) as GeminiApiResponse;
        const rawOutput = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawOutput) continue;

        const parsed: unknown = JSON.parse(stripJsonCodeFences(rawOutput));
        if (isRecord(parsed)) {
          return parsed as RawParsedAiDocument;
        }
      } catch (err: unknown) {
        console.warn(`[FinanceAiIngestor] Error with model ${model}:`, err);
      }
    }
    return null;
  }

  private mapAiPayloadToDocument(
    parsed: RawParsedAiDocument,
    currentBcv: number,
    defaults: {
      title: string;
      currency: CurrencyCode;
      channel: PaymentChannel;
      rawText?: string;
    },
  ): ParsedFinancialDocument {
    const rawCurrency = String(parsed.currency ?? '').toUpperCase() as CurrencyCode;
    const currency: CurrencyCode = VALID_CURRENCIES.includes(rawCurrency)
      ? rawCurrency
      : defaults.currency;

    const rawScope = String(parsed.scope ?? '') as FinanceScope;
    const scope: FinanceScope = VALID_SCOPES.includes(rawScope) ? rawScope : 'personal';

    const rawPillar = String(parsed.pillar ?? '') as FinancialPillar;
    const pillar: FinancialPillar = VALID_PILLARS.includes(rawPillar)
      ? rawPillar
      : FINANCIAL_PILLAR.EXPENSE;

    const rawChannel = String(parsed.channel ?? '') as PaymentChannel;
    const channel: PaymentChannel = VALID_CHANNELS.includes(rawChannel)
      ? rawChannel
      : defaults.channel;

    const amountVal =
      typeof parsed.amount === 'number'
        ? parsed.amount
        : typeof parsed.amount === 'string'
          ? parseLocaleAmount(parsed.amount)
          : 0;

    const installmentNum = Number(parsed.casheaInstallmentNumber);
    const casheaInstallmentNumber =
      Number.isInteger(installmentNum) && installmentNum >= 1 && installmentNum <= 24
        ? installmentNum
        : undefined;

    const confidenceVal = Number(parsed.confidence);
    const confidence =
      Number.isFinite(confidenceVal) && confidenceVal > 0 && confidenceVal <= 1
        ? confidenceVal
        : 0.9;

    return {
      title:
        typeof parsed.title === 'string' && parsed.title.trim().length > 0
          ? parsed.title.trim()
          : defaults.title,
      amount: Number.isFinite(amountVal) ? amountVal : 0,
      currency,
      bcvRateApplied: currentBcv,
      scope,
      pillar,
      expenseCategory:
        typeof parsed.expenseCategory === 'string'
          ? (parsed.expenseCategory as ExpenseCategory)
          : 'other',
      incomeCategory:
        typeof parsed.incomeCategory === 'string'
          ? (parsed.incomeCategory as IncomeCategory)
          : undefined,
      channel,
      referenceNumber:
        typeof parsed.referenceNumber === 'string' && parsed.referenceNumber.trim().length > 0
          ? parsed.referenceNumber.trim()
          : undefined,
      entityName:
        typeof parsed.entityName === 'string' && parsed.entityName.trim().length > 0
          ? parsed.entityName.trim()
          : undefined,
      date:
        typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date.trim())
          ? parsed.date.trim()
          : todayVetIso(),
      isCashea: Boolean(parsed.isCashea),
      casheaInstallmentNumber,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      rawText: defaults.rawText,
      confidence,
    };
  }

  /**
   * Multimodal Vision Analysis: Routes through Electron main-process proxy when available,
   * falls back to SecureVault-backed Gemini API in web/Capacitor mode, or heuristic parsing.
   */
  async analyzeReceiptImage(
    imageBase64: string,
    mimeType = 'image/jpeg',
    ocrTextFallback?: string,
  ): Promise<ParsedFinancialDocument> {
    const currentBcv = this.getCurrentBcvRate();
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    const cleanMime = mimeType.split(';')[0] || 'image/jpeg';

    const prompt = `Actúa como un Auditor Contable y Financiero Senior en Venezuela. Analiza la imagen de este comprobante, factura comercial, recibo de punto de venta, captura de pago móvil o captura de cuota Cashea.
Extrae los datos en formato JSON EXACTO con esta estructura (sin texto extra):
{
  "title": "Descripción breve y clara del gasto o ingreso",
  "amount": 12.50,
  "currency": "USD" | "VES" | "EUR",
  "scope": "personal" | "business",
  "pillar": "expense" | "income" | "liability",
  "expenseCategory": "groceries" | "housing" | "transport" | "services" | "cashea_installment" | "provider_merchandise" | "payroll" | "maintenance" | "other",
  "incomeCategory": "salary" | "p2p_profit" | "business_sale" | "freelance" | "other",
  "channel": "bs_bank" | "zelle" | "cash" | "crypto" | "other",
  "referenceNumber": "número de referencia si existe",
  "entityName": "nombre de la tienda, comercio o persona",
  "date": "YYYY-MM-DD",
  "isCashea": true si es de la app Cashea o cuota de Cashea, false en caso contrario,
  "casheaInstallmentNumber": número de cuota si aplica o null,
  "notes": "detalles clave detectados",
  "confidence": número entre 0 y 1
}`;

    const electronBridge = getElectronFinance360Bridge();
    if (electronBridge?.aiAnalyze) {
      const proxied = await this.invokeElectronAiProxy(electronBridge, prompt, {
        mimeType: cleanMime,
        data: cleanBase64,
      });
      if (proxied) {
        return this.mapAiPayloadToDocument(proxied, currentBcv, {
          title: 'Comprobante procesado por IA',
          currency: 'VES',
          channel: 'bs_bank',
          rawText: ocrTextFallback,
        });
      }
      return this.parseWithHeuristics(ocrTextFallback ?? '', currentBcv);
    }

    const apiKey = await this.resolveGeminiApiKey();
    if (!apiKey) {
      return this.parseWithHeuristics(ocrTextFallback ?? '', currentBcv);
    }

    const direct = await this.invokeGeminiDirect(apiKey, prompt, {
      mimeType: cleanMime,
      data: cleanBase64,
    });
    if (direct) {
      return this.mapAiPayloadToDocument(direct, currentBcv, {
        title: 'Comprobante procesado por IA',
        currency: 'VES',
        channel: 'bs_bank',
        rawText: ocrTextFallback,
      });
    }

    return this.parseWithHeuristics(ocrTextFallback ?? '', currentBcv);
  }

  /**
   * Voice-to-Ledger: Transcribes audio note and classifies into financial entry.
   */
  async transcribeAndClassifyAudio(
    audioBase64: string,
    mimeType = 'audio/webm',
  ): Promise<ParsedFinancialDocument> {
    const currentBcv = this.getCurrentBcvRate();
    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const cleanMime = mimeType.split(';')[0] || 'audio/webm';
    const today = todayVetIso();

    const prompt = `Escucha atentamente este audio dictado por el usuario sobre una transacción financiera (ej: "Gasté 15 dólares en pintura", "Cobré 80 dólares por un trabajo de latonería", "Pagué la cuota de Cashea").
Extrae los datos en formato JSON EXACTO con esta estructura:
{
  "title": "Descripción clara del movimiento",
  "amount": número detectado,
  "currency": "USD" | "VES",
  "scope": "personal" | "business",
  "pillar": "expense" | "income" | "liability",
  "expenseCategory": "groceries" | "housing" | "transport" | "services" | "cashea_installment" | "provider_merchandise" | "payroll" | "other",
  "channel": "cash" | "bs_bank" | "zelle" | "crypto" | "other",
  "date": "${today}",
  "isCashea": boolean,
  "confidence": 0.95
}`;

    const electronBridge = getElectronFinance360Bridge();
    if (electronBridge?.aiAnalyze) {
      const proxied = await this.invokeElectronAiProxy(electronBridge, prompt, {
        mimeType: cleanMime,
        data: cleanBase64,
      });
      if (proxied) {
        return this.mapAiPayloadToDocument(proxied, currentBcv, {
          title: 'Dictado por voz',
          currency: 'USD',
          channel: 'cash',
        });
      }
      return this.parseWithHeuristics('Dictado de audio', currentBcv);
    }

    const apiKey = await this.resolveGeminiApiKey();
    if (!apiKey) {
      return this.parseWithHeuristics('', currentBcv);
    }

    const direct = await this.invokeGeminiDirect(apiKey, prompt, {
      mimeType: cleanMime,
      data: cleanBase64,
    });
    if (direct) {
      return this.mapAiPayloadToDocument(direct, currentBcv, {
        title: 'Dictado por voz',
        currency: 'USD',
        channel: 'cash',
      });
    }

    return this.parseWithHeuristics('Dictado de audio', currentBcv);
  }

  /**
   * Deterministic local fallback using locale-aware numeric and Cashea heuristics.
   */
  parseWithHeuristics(text: string, bcvRate: number): ParsedFinancialDocument {
    const today = todayVetIso();
    const isCashea = /cashea/i.test(text);

    // Detect Cashea installment number (e.g. "Cuota 2 de 3", "Cuota #1", "3ra cuota")
    let casheaInstallmentNumber: number | undefined;
    if (isCashea) {
      const cuotaMatch =
        text.match(/cuota\s*(?:n[°ºo.]?\s*|#\s*)?(\d{1,2})\b/i) ??
        text.match(/\b(\d{1,2})(?:ra|da|ta|va|na|er|°|º)?\s*cuota\b/i) ??
        text.match(/installment\s*(?:#\s*)?(\d{1,2})\b/i);
      if (cuotaMatch) {
        const parsedInstallment = Number.parseInt(cuotaMatch[1], 10);
        if (parsedInstallment >= 1 && parsedInstallment <= 24) {
          casheaInstallmentNumber = parsedInstallment;
        }
      }
    }

    // Detect amount and currency accurately without 100x corruption
    const extracted = extractAmountAndCurrency(text);
    const amount = extracted.amount;

    let currency: CurrencyCode = extracted.currencyHint ?? 'VES';
    if (!extracted.currencyHint) {
      if (/\busdt\b|tether/i.test(text)) {
        currency = 'USDT';
      } else if (/€|\beur\b|euros?\b/i.test(text)) {
        currency = 'EUR';
      } else if (/\$|\busd\b|d[oó]lares|dolares/i.test(text)) {
        currency = 'USD';
      } else {
        currency = 'VES';
      }
    }

    // Detect reference number (must include at least one digit so "Comprobante de pago" is ignored)
    const refMatch = text.match(
      /(?:ref(?:erencia)?|comprobante|operaci[oó]n|nro\.?\s*ref(?:erencia)?)[:\s#-]*([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/i,
    );
    const referenceNumber = refMatch ? refMatch[1] : undefined;

    // Detect category and scope
    let expenseCategory: ExpenseCategory = 'other';
    const pillar: FinancialPillar = FINANCIAL_PILLAR.EXPENSE;
    let scope: FinanceScope = 'personal';

    if (isCashea) {
      expenseCategory = 'cashea_installment';
    } else if (/proveedor|factura|mercanc[ií]a|repuesto|pintura/i.test(text)) {
      expenseCategory = 'provider_merchandise';
      scope = 'business';
    } else if (/n[oó]mina|sueldo|pago\s+de\s+personal/i.test(text)) {
      expenseCategory = 'payroll';
      scope = 'business';
    } else if (/alquiler|arriendo/i.test(text)) {
      expenseCategory = 'rent';
    } else if (/gasolina|transporte|uber|taxi/i.test(text)) {
      expenseCategory = 'transport';
    } else if (/comida|mercado|alimento|supermercado/i.test(text)) {
      expenseCategory = 'groceries';
    }

    const title = isCashea
      ? casheaInstallmentNumber
        ? `Cuota #${casheaInstallmentNumber} Cashea`
        : 'Cuota Cashea'
      : 'Comprobante procesado';

    return {
      title,
      amount,
      currency,
      bcvRateApplied: Number.isFinite(bcvRate) && bcvRate >= 0 ? bcvRate : 0,
      scope,
      pillar,
      expenseCategory,
      channel: currency === 'USD' || currency === 'EUR' ? 'cash' : 'bs_bank',
      referenceNumber,
      date: today,
      isCashea,
      casheaInstallmentNumber,
      rawText: text,
      confidence: 0.7,
    };
  }
}
