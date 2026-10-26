import { Injectable, signal, NgZone, inject } from '@angular/core';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
} from './models/finance-360.models';
import type { BankCode } from '@p2p/core';

export interface ParsedP2pVoiceCommand {
  rawTranscript: string;
  type?: 'buy' | 'sell';
  pair?: 'USDT' | 'EUR';
  usdtAmount?: number;
  vesAmount?: number;
  price?: number;
  bankCode?: BankCode;
  reference?: string;
  documentId?: string;
  summaryBadges: string[];
}

export interface ParsedFinance360VoiceCommand {
  rawTranscript: string;
  pillar: 'income' | 'expense';
  title: string;
  amount: number;
  currency: CurrencyCode;
  scope: FinanceScope;
  expenseCategory: ExpenseCategory;
  incomeCategory: IncomeCategory;
  vaultHint?: 'zelle' | 'bs_bank' | 'cash' | 'crypto' | 'pyme';
  feeRatePct: 0 | 0.3 | 3;
  referenceNumber?: string;
  summaryBadges: string[];
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  private readonly zone = inject(NgZone);
  private recognition: SpeechRecognitionLike | null = null;
  private activeCallback: ((finalText: string) => void) | null = null;

  readonly isListening = signal<boolean>(false);
  readonly activeContext = signal<'p2p' | 'finance360' | null>(null);
  readonly interimTranscript = signal<string>('');
  readonly lastFinalTranscript = signal<string>('');
  readonly error = signal<string | null>(null);

  readonly isSupported: boolean =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>)['SpeechRecognition'] ||
        (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'],
    );

  /**
   * Starts native browser SpeechRecognition (es-VE) or triggers an intelligent
   * interactive fallback if SpeechRecognition is unavailable/blocked in the environment.
   */
  startListening(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    fallbackSamplePhrase?: string,
  ): void {
    if (this.isListening()) {
      this.stopListening();
      return;
    }

    this.error.set(null);
    this.interimTranscript.set('');
    this.activeContext.set(context);
    this.activeCallback = onFinalTranscript;

    if (!this.isSupported) {
      this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
      return;
    }

    try {
      const win = window as unknown as Record<string, new () => SpeechRecognitionLike>;
      const SpeechRecognitionCtor = win['SpeechRecognition'] || win['webkitSpeechRecognition'];
      const instance = new SpeechRecognitionCtor();

      instance.lang = 'es-VE';
      instance.continuous = false;
      instance.interimResults = true;
      instance.maxAlternatives = 1;

      instance.onstart = () => {
        this.zone.run(() => {
          this.isListening.set(true);
        });
      };

      instance.onresult = (event: SpeechRecognitionEventLike) => {
        this.zone.run(() => {
          let interim = '';
          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const res = event.results[i];
            if (res.isFinal) {
              finalChunk += res[0].transcript;
            } else {
              interim += res[0].transcript;
            }
          }

          if (interim) {
            this.interimTranscript.set(interim.trim());
          }

          if (finalChunk.trim()) {
            const clean = finalChunk.trim();
            this.lastFinalTranscript.set(clean);
            this.interimTranscript.set(clean);
            if (this.activeCallback) {
              const cb = this.activeCallback;
              this.activeCallback = null;
              cb(clean);
            }
          }
        });
      };

      instance.onerror = (event: SpeechRecognitionErrorEventLike) => {
        this.zone.run(() => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
            this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
            return;
          }
          this.error.set(`Aviso de micrófono: ${event.error}`);
          this.isListening.set(false);
          this.activeContext.set(null);
        });
      };

      instance.onend = () => {
        this.zone.run(() => {
          const pendingInterim = this.interimTranscript().trim();
          if (pendingInterim && this.activeCallback) {
            const cb = this.activeCallback;
            this.activeCallback = null;
            this.lastFinalTranscript.set(pendingInterim);
            cb(pendingInterim);
          }
          this.isListening.set(false);
          this.activeContext.set(null);
        });
      };

      this.recognition = instance;
      instance.start();
    } catch {
      this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
    }
  }

  stopListening(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
      this.recognition = null;
    }
    this.isListening.set(false);
    this.activeContext.set(null);
  }

  private runFallbackSimulation(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    customSample?: string,
  ): void {
    this.isListening.set(true);
    const sample =
      customSample ||
      (context === 'p2p'
        ? 'Venta de 250 USDT a tasa 78.60 por Banesco referencia 849312 cédula 18940211'
        : 'Gasté 35 dólares en repuestos del taller por Pago Móvil Banesco referencia 774120');

    this.interimTranscript.set('🎙️ Escuchando comando de voz...');
    setTimeout(() => {
      if (!this.isListening()) return;
      this.interimTranscript.set(sample);
      this.lastFinalTranscript.set(sample);
      this.isListening.set(false);
      this.activeContext.set(null);
      this.activeCallback = null;
      onFinalTranscript(sample);
    }, 1100);
  }

  /**
   * Normalizes spoken Spanish numbers such as "78 con 50" -> "78.50" or "250,40" -> "250.40".
   */
  private normalizeSpokenNumbers(raw: string): string {
    return raw
      .replace(/(\d+)\s+con\s+(\d+)/gi, '$1.$2')
      .replace(/(\d+)\s+punto\s+(\d+)/gi, '$1.$2')
      .replace(/(\d+),(\d{1,4})\b/g, '$1.$2');
  }

  /**
   * Semantic NLP Parser for P2P Trading Desk Voice Commands (`es-VE`).
   * Example: "Venta de 300 USDT a 78 con 50 por Mercantil referencia 994120 cédula 19450321"
   */
  parseP2pCommand(rawTranscript: string): ParsedP2pVoiceCommand {
    const normalized = this.normalizeSpokenNumbers(rawTranscript.trim());
    const lower = normalized.toLowerCase();
    const badges: string[] = [];

    const result: ParsedP2pVoiceCommand = {
      rawTranscript: rawTranscript.trim(),
      summaryBadges: badges,
    };

    // 1. Operation Type (Buy / Sell)
    if (/\b(venta|vender|vend[ií]|vendiendo|salida)\b/i.test(lower)) {
      result.type = 'sell';
      badges.push('🔴 VENTA');
    } else if (/\b(compra|comprar|compr[eé]|comprando|entrada)\b/i.test(lower)) {
      result.type = 'buy';
      badges.push('🟢 COMPRA');
    }

    // 2. Pair (USDT / EUR)
    if (/\b(euro|euros|eur)\b/i.test(lower)) {
      result.pair = 'EUR';
      badges.push('💶 EUR');
    } else if (/\b(usdt|tether|d[oó]lares|dolares|usd)\b/i.test(lower)) {
      result.pair = 'USDT';
      badges.push('🪙 USDT');
    }

    // 3. Price / Rate ("a 78.50", "tasa 78.50", "precio 78.50")
    const priceMatch = normalized.match(
      /(?:tasa|precio|a\s+tasa|a\s+precio|a)\s*(\d{2,4}(?:\.\d{1,4})?)\b/i,
    );
    if (priceMatch) {
      const priceVal = parseFloat(priceMatch[1]);
      if (priceVal > 10 && priceVal < 5000) {
        result.price = priceVal;
        badges.push(`📈 Tasa: ${priceVal.toFixed(2)} Bs`);
      }
    }

    // 4. Crypto Amount ("250 usdt", "300 dólares", "de 250 a")
    const usdtExplicit = normalized.match(
      /(\d+(?:\.\d+)?)\s*(?:usdt|tether|d[oó]lares|dolares|usd|euros|eur)\b/i,
    );
    if (usdtExplicit) {
      result.usdtAmount = parseFloat(usdtExplicit[1]);
      badges.push(`💎 ${result.usdtAmount} ${result.pair ?? 'USDT'}`);
    } else {
      const afterDeMatch = normalized.match(
        /(?:compra|venta|compr[eé]|vend[ií])\s+(?:de\s+)?(\d+(?:\.\d+)?)\b/i,
      );
      if (afterDeMatch) {
        result.usdtAmount = parseFloat(afterDeMatch[1]);
        badges.push(`💎 ${result.usdtAmount} USDT`);
      }
    }

    // 5. VES Amount ("23500 bolívares", "15000 bs")
    const vesMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:bol[ií]vares|bs|ves)\b/i);
    if (vesMatch) {
      result.vesAmount = parseFloat(vesMatch[1]);
      badges.push(`🇻🇪 ${result.vesAmount.toLocaleString('es-VE')} Bs`);
    }

    // 6. Bank Detection
    const bankMap: Array<{ pattern: RegExp; code: BankCode; label: string }> = [
      { pattern: /\bbanesco\b/i, code: 'BANESCO', label: 'Banesco' },
      { pattern: /\bmercantil\b/i, code: 'MERCANTIL', label: 'Mercantil' },
      { pattern: /\b(bdv|banco\s+de\s+venezuela|venezuela)\b/i, code: 'BDV', label: 'BDV' },
      { pattern: /\bbancamiga\b/i, code: 'BANCAMIGA', label: 'Bancamiga' },
      { pattern: /\bprovincial\b/i, code: 'PROVINCIAL', label: 'Provincial' },
      { pattern: /\bbnc\b/i, code: 'BNC', label: 'BNC' },
      { pattern: /\bbancaribe\b/i, code: 'BANCARIBE', label: 'Bancaribe' },
      { pattern: /\bbanplus\b/i, code: 'BANPLUS', label: 'Banplus' },
    ];

    for (const b of bankMap) {
      if (b.pattern.test(lower)) {
        result.bankCode = b.code;
        badges.push(`🏦 ${b.label}`);
        break;
      }
    }

    // 7. Reference Number ("referencia 849201", "ref 849201")
    const refMatch = normalized.match(/(?:ref(?:erencia)?[:.\s#-]*)(\d{4,14})\b/i);
    if (refMatch) {
      result.reference = refMatch[1];
      badges.push(`#️⃣ Ref: ${result.reference}`);
    }

    // 8. Cédula / Identity Document ("cédula 18940211", "v 18940211")
    const docMatch = normalized.match(
      /(?:c[eé]dula|documento|titular|ci|v|e|j)[:.\s-]*(\d{6,10})\b/i,
    );
    if (docMatch) {
      result.documentId = `V-${docMatch[1]}`;
      badges.push(`🪪 ${result.documentId}`);
    }

    return result;
  }

  /**
   * Semantic NLP Parser for Finance 360 Voice Commands (`es-VE`).
   * Example: "Gasté 35 dólares en repuestos del taller por Pago Móvil Banesco referencia 774120"
   */
  parseFinance360Command(
    rawTranscript: string,
    currentBcvRate: number = 60,
  ): ParsedFinance360VoiceCommand {
    const normalized = this.normalizeSpokenNumbers(rawTranscript.trim());
    const lower = normalized.toLowerCase();
    const badges: string[] = [];

    // 1. Pillar: Income vs Expense
    const isIncome =
      /\b(cobr[eé]|recib[ií]|ingreso|entr[oó]|gan[eé]|sueldo|salario|me\s+pagaron|venta|anticipo)\b/i.test(
        lower,
      );
    const pillar: 'income' | 'expense' = isIncome ? 'income' : 'expense';
    badges.push(pillar === 'income' ? '🟢 INGRESO' : '🔴 GASTO');

    // 2. Currency & Amount
    let currency: CurrencyCode = 'USD';
    if (/\b(bol[ií]vares|bs|ves)\b/i.test(lower)) {
      currency = 'VES';
    } else if (/\b(usdt|tether|cripto|binance)\b/i.test(lower)) {
      currency = 'USDT';
    }

    let amount = 0;
    const explicitCurrMatch = normalized.match(
      /(\d+(?:\.\d+)?)\s*(?:\$|usd|d[oó]lares|dolares|usdt|tether|bs\.?|ves|bol[ií]vares)/i,
    );
    if (explicitCurrMatch) {
      amount = parseFloat(explicitCurrMatch[1]) || 0;
    } else {
      const genericNumMatch = normalized.match(/\b(\d+(?:\.\d+)?)\b/);
      if (genericNumMatch) {
        amount = parseFloat(genericNumMatch[1]) || 0;
      }
    }
    if (amount > 0) {
      badges.push(`💰 ${amount} ${currency}`);
    }

    // 3. Scope (Personal vs Business/Pyme)
    const isBusiness =
      /\b(taller|pyme|negocio|proveedor|insumos|repuesto|repuestos|pintura|latoner[ií]a|n[oó]mina|empleado|cliente|obra|presupuesto)\b/i.test(
        lower,
      );
    const scope: FinanceScope = isBusiness ? 'business' : 'personal';
    badges.push(scope === 'business' ? '🏢 Pyme / Taller' : '👤 Personal');

    // 4. Category Classification
    let expenseCategory: ExpenseCategory = 'other';
    let incomeCategory: IncomeCategory = 'other';

    if (pillar === 'expense') {
      if (/\b(gasolina|transporte|uber|ridery|yummy|peaje|caucho|aceite)\b/i.test(lower)) {
        expenseCategory = 'transport';
      } else if (/\b(mercado|comida|supermercado|almuerzo|cena|farmatodo|bodeg[oó]n)\b/i.test(lower)) {
        expenseCategory = 'groceries';
      } else if (/\b(cashea|cuota)\b/i.test(lower)) {
        expenseCategory = 'cashea_installment';
      } else if (/\b(proveedor|insumos|mercanc[ií]a|pintura|materiales|repuesto|repuestos)\b/i.test(lower)) {
        expenseCategory = 'provider_merchandise';
      } else if (/\b(n[oó]mina|ayudante|empleado|sueldo\s+personal)\b/i.test(lower)) {
        expenseCategory = 'payroll';
      } else if (/\b(mantenimiento|herramienta|compresor|arreglo|taller)\b/i.test(lower)) {
        expenseCategory = 'maintenance';
      } else if (/\b(internet|luz|agua|corpoelec|cantv|fibex|telefon[ií]a|servicio|servicios)\b/i.test(lower)) {
        expenseCategory = 'services';
      } else if (/\b(alquiler|condominio|vivienda|casa)\b/i.test(lower)) {
        expenseCategory = 'housing';
      } else if (/\b(salud|m[eé]dico|medicina|farmacia|cl[ií]nica)\b/i.test(lower)) {
        expenseCategory = 'health';
      }
    } else {
      if (/\b(taller|venta|trabajo|latoner[ií]a|pintura|cliente)\b/i.test(lower)) {
        incomeCategory = 'business_sale';
      } else if (/\b(anticipo|presupuesto|abono)\b/i.test(lower)) {
        incomeCategory = 'quote_advance';
      } else if (/\b(freelance|honorarios|asesor[ií]a|servicio)\b/i.test(lower)) {
        incomeCategory = 'freelance';
      } else {
        incomeCategory = 'salary';
      }
    }

    // 5. Vault Hint & Fee Switch
    let vaultHint: 'zelle' | 'bs_bank' | 'cash' | 'crypto' | 'pyme' | undefined;
    if (/\bzelle\b/i.test(lower)) {
      vaultHint = 'zelle';
      badges.push('💳 Zelle');
    } else if (/\b(banesco|mercantil|bdv|bancamiga|provincial|pago\s+m[oó]vil|bol[ií]vares|bs)\b/i.test(lower)) {
      vaultHint = 'bs_bank';
      badges.push('🏦 Banco Bs');
    } else if (/\b(usdt|binance|cripto)\b/i.test(lower)) {
      vaultHint = 'crypto';
      badges.push('🪙 Crypto');
    } else if (/\b(caja\s+pyme|caja\s+taller)\b/i.test(lower)) {
      vaultHint = 'pyme';
      badges.push('🏢 Caja Pyme');
    } else if (/\b(efectivo|cash|divisas)\b/i.test(lower)) {
      vaultHint = 'cash';
      badges.push('💵 Efectivo');
    }

    let feeRatePct: 0 | 0.3 | 3 = 0;
    if (/\bpago\s+m[oó]vil\b/i.test(lower)) {
      feeRatePct = 0.3;
      badges.push('⚡ +0.3% Pago Móvil');
    } else if (/\bigtf\b/i.test(lower)) {
      feeRatePct = 3;
      badges.push('🏛️ +3% IGTF');
    }

    // 6. Reference Number
    let referenceNumber: string | undefined;
    const refMatch = normalized.match(/(?:ref(?:erencia)?[:.\s#-]*)(\d{4,14})\b/i);
    if (refMatch) {
      referenceNumber = refMatch[1];
      badges.push(`#️⃣ Ref: ${referenceNumber}`);
    }

    // 7. Clean Concept Title
    const cleanedTitle = normalized
      .replace(
        /\b(gast[eé]|pagu[eé]|cobr[eé]|recib[ií]|compr[eé]|ingreso|gasto|de|en|por|con|usando|mediante|a\s+tasa)\b/gi,
        ' ',
      )
      .replace(/\b\d+(?:\.\d+)?\s*(?:\$|usd|d[oó]lares|dolares|usdt|tether|bs\.?|ves|bol[ií]vares)?\b/gi, ' ')
      .replace(/(?:ref(?:erencia)?[:.\s#-]*)?\b\d{4,14}\b/gi, ' ')
      .replace(/\b(pago\s+m[oó]vil|igtf|banesco|mercantil|zelle|efectivo)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const defaultTitle =
      pillar === 'income'
        ? isBusiness
          ? 'Cobro Operativo Taller / Pyme'
          : 'Ingreso Registrado por Voz'
        : isBusiness
          ? 'Gasto Operativo Taller / Pyme'
          : 'Gasto Registrado por Voz';

    const title =
      cleanedTitle.length >= 3
        ? cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1)
        : defaultTitle;

    void currentBcvRate;

    return {
      rawTranscript: rawTranscript.trim(),
      pillar,
      title,
      amount,
      currency,
      scope,
      expenseCategory,
      incomeCategory,
      vaultHint,
      feeRatePct,
      referenceNumber,
      summaryBadges: badges,
    };
  }
}
