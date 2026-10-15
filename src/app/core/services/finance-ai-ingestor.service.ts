import { Injectable, inject } from '@angular/core';
import { StorageService } from '../storage';
import { CotizaveService } from '../cotizave.service';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
  PaymentChannel,
} from '../models/finance-360.models';

export interface ParsedFinancialDocument {
  title: string;
  amount: number;
  currency: CurrencyCode;
  bcvRateApplied: number;
  scope: FinanceScope;
  pillar: 'expense' | 'income' | 'liability';
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

const CANDIDATE_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

@Injectable({ providedIn: 'root' })
export class FinanceAiIngestorService {
  private readonly storage = inject(StorageService);
  private readonly cotizaveService = inject(CotizaveService);

  private getGeminiApiKey(): string {
    return (
      this.storage.get<string>('p2p.gemini.apiKey') ||
      this.storage.get<string>('p2p.ai.key.gemini') ||
      ''
    );
  }

  /**
   * Multimodal Vision Analysis: Sends receipt/invoice image to Gemini
   * or falls back to heuristic parsing if API key is not configured.
   */
  async analyzeReceiptImage(
    imageBase64: string,
    mimeType: string = 'image/jpeg',
    ocrTextFallback?: string,
  ): Promise<ParsedFinancialDocument> {
    const apiKey = this.getGeminiApiKey().trim();
    const rates = this.cotizaveService.ratesByMarket();
    const currentBcv = rates['oficial']?.mid ?? 60.0;

    if (!apiKey) {
      return this.parseWithHeuristics(ocrTextFallback || '', currentBcv);
    }

    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
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
                parts: [
                  { text: prompt },
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
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const rawOutput = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawOutput) {
            const parsed = JSON.parse(rawOutput);
            return {
              title: parsed.title || 'Comprobante procesado por IA',
              amount: Number(parsed.amount) || 0,
              currency: (['USD', 'VES', 'EUR'].includes(parsed.currency)
                ? parsed.currency
                : 'VES') as CurrencyCode,
              bcvRateApplied: currentBcv,
              scope: (['personal', 'business'].includes(parsed.scope)
                ? parsed.scope
                : 'personal') as FinanceScope,
              pillar: (['expense', 'income', 'liability'].includes(parsed.pillar)
                ? parsed.pillar
                : 'expense') as 'expense' | 'income' | 'liability',
              expenseCategory: parsed.expenseCategory || 'other',
              incomeCategory: parsed.incomeCategory,
              channel: (parsed.channel || 'bs_bank') as PaymentChannel,
              referenceNumber: parsed.referenceNumber || undefined,
              entityName: parsed.entityName || undefined,
              date: parsed.date || new Date().toISOString().split('T')[0],
              isCashea: Boolean(parsed.isCashea),
              casheaInstallmentNumber: parsed.casheaInstallmentNumber || undefined,
              notes: parsed.notes || '',
              rawText: ocrTextFallback,
              confidence: Number(parsed.confidence) || 0.9,
            };
          }
        }
      } catch (err) {
        console.warn(`[FinanceAiIngestor] Error with model ${model}:`, err);
      }
    }

    return this.parseWithHeuristics(ocrTextFallback || '', currentBcv);
  }

  /**
   * Voice-to-Ledger: Transcribes audio note and classifies into financial entry
   */
  async transcribeAndClassifyAudio(
    audioBase64: string,
    mimeType: string = 'audio/webm',
  ): Promise<ParsedFinancialDocument> {
    const apiKey = this.getGeminiApiKey().trim();
    const rates = this.cotizaveService.ratesByMarket();
    const currentBcv = rates['oficial']?.mid ?? 60.0;

    if (!apiKey) {
      return this.parseWithHeuristics('', currentBcv);
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
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
  "date": "${new Date().toISOString().split('T')[0]}",
  "isCashea": boolean,
  "confidence": 0.95
}`;

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
                parts: [
                  { text: prompt },
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
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const rawOutput = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawOutput) {
            const parsed = JSON.parse(rawOutput);
            return {
              title: parsed.title || 'Dictado por voz',
              amount: Number(parsed.amount) || 0,
              currency: (parsed.currency || 'USD') as CurrencyCode,
              bcvRateApplied: currentBcv,
              scope: (parsed.scope || 'personal') as FinanceScope,
              pillar: (parsed.pillar || 'expense') as 'expense' | 'income' | 'liability',
              expenseCategory: parsed.expenseCategory || 'other',
              channel: (parsed.channel || 'cash') as PaymentChannel,
              date: parsed.date || new Date().toISOString().split('T')[0],
              isCashea: Boolean(parsed.isCashea),
              confidence: Number(parsed.confidence) || 0.9,
            };
          }
        }
      } catch (err) {
        console.warn(`[FinanceAiIngestor] Audio transcription error with model ${model}:`, err);
      }
    }

    return this.parseWithHeuristics('Dictado de audio', currentBcv);
  }

  /**
   * Deterministic local fallback using Regex heuristics
   */
  parseWithHeuristics(text: string, bcvRate: number): ParsedFinancialDocument {
    const today = new Date().toISOString().split('T')[0];
    const isCashea = /cashea/i.test(text);

    // Detect amounts
    const amountMatch = text.match(/(?:bs\.?|ves|\$|usd)?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i);
    let amount = 0;
    if (amountMatch) {
      const clean = amountMatch[1].replace(/\./g, '').replace(',', '.');
      amount = parseFloat(clean) || 0;
    }

    const isUsd = /\$|usd|dolares|dólares/i.test(text);
    const currency: CurrencyCode = isUsd ? 'USD' : 'VES';

    // Detect reference
    const refMatch = text.match(/(?:ref|referencia|comprobante|operaci[oó]n)[:\s#]*([A-Za-z0-9-]+)/i);
    const referenceNumber = refMatch ? refMatch[1] : undefined;

    // Detect category
    let expenseCategory: ExpenseCategory = 'other';
    let pillar: 'expense' | 'income' | 'liability' = 'expense';
    let scope: FinanceScope = 'personal';

    if (isCashea) {
      expenseCategory = 'cashea_installment';
      pillar = 'expense';
    } else if (/proveedor|factura|mercancia|repuesto|pintura/i.test(text)) {
      expenseCategory = 'provider_merchandise';
      scope = 'business';
    } else if (/n[oó]mina|sueldo|pago de personal/i.test(text)) {
      expenseCategory = 'payroll';
      scope = 'business';
    } else if (/alquiler|arriendo/i.test(text)) {
      expenseCategory = 'rent';
    } else if (/gasolina|transporte|uber|taxi/i.test(text)) {
      expenseCategory = 'transport';
    } else if (/comida|mercado|alimento|supermercado/i.test(text)) {
      expenseCategory = 'groceries';
    }

    return {
      title: isCashea ? 'Cuota Cashea' : 'Comprobante procesado',
      amount,
      currency,
      bcvRateApplied: bcvRate,
      scope,
      pillar,
      expenseCategory,
      channel: isUsd ? 'cash' : 'bs_bank',
      referenceNumber,
      date: today,
      isCashea,
      rawText: text,
      confidence: 0.7,
    };
  }
}
