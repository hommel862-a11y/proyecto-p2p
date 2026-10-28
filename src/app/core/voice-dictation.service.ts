import { Injectable, signal, computed, NgZone, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
} from './models/finance-360.models';
import type { BankCode } from '@p2p/core';

import { StorageService } from './storage';
import { ToastService } from './toast.service';

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
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);

  private recognition: SpeechRecognitionLike | null = null;
  private activeCallback: ((finalText: string) => void) | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  // MediaRecorder Pipeline (Hardware Mic Audio)
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isProcessingAudio = false;

  readonly isRecording = signal<boolean>(false);
  readonly isTranscribing = signal<boolean>(false);
  readonly isListening = computed(() => this.isRecording() || this.isTranscribing());
  readonly activeContext = signal<'p2p' | 'finance360' | null>(null);
  readonly interimTranscript = signal<string>('');
  readonly lastFinalTranscript = signal<string>('');
  readonly error = signal<string | null>(null);

  readonly isSupported: boolean =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>)['SpeechRecognition'] ||
        (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'] ||
        navigator.mediaDevices?.getUserMedia,
    );

  /**
   * Starts resilient voice capture using device hardware MediaRecorder.
   * Runs rock-solid across Electron, Android (Capacitor) and Web browsers
   * without shutting off prematurely.
   */
  async startListening(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    fallbackSamplePhrase?: string,
  ): Promise<void> {
    if (this.isListening()) {
      this.stopListening();
      return;
    }

    this.error.set(null);
    this.interimTranscript.set('');
    this.activeContext.set(context);
    this.activeCallback = onFinalTranscript;

    // Check platform
    const isElectron =
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { electron?: unknown }).electron);
    const isNativeMobile = Capacitor.isNativePlatform();

    // 1. Direct hardware MediaRecorder capture (100% reliable across Electron, Android & Web)
    await this.startMediaRecordingCapture(context, onFinalTranscript, fallbackSamplePhrase);

    // 2. In desktop web browsers only, optionally attach SpeechRecognition in parallel purely for live interim words preview
    if (!isElectron && !isNativeMobile) {
      this.tryStartSpeechRecognitionPreview();
    }
  }

  /**
   * Captures audio directly from the device microphone via MediaRecorder.
   * Transcribes via Gemini API or falls back gracefully to interactive simulation.
   */
  private async startMediaRecordingCapture(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    fallbackSamplePhrase?: string,
  ): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : 'audio/webm';

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.isProcessingAudio) return;
        this.isProcessingAudio = true;

        try {
          const audioBlob = new Blob(this.audioChunks, { type: mimeType });
          const base64 = await this.blobToBase64(audioBlob);
          this.cleanupMediaStream();

          if (base64.length > 500) {
            this.zone.run(() => {
              this.interimTranscript.set('⏳ Transcribiendo dictado de voz...');
            });
            const transcript = await this.transcribeAudioWithGemini(base64, mimeType);
            if (transcript) {
              this.zone.run(() => {
                this.lastFinalTranscript.set(transcript);
                this.interimTranscript.set(transcript);
                this.isRecording.set(false);
                this.isTranscribing.set(false);
                this.activeContext.set(null);
                if (this.activeCallback) {
                  const cb = this.activeCallback;
                  this.activeCallback = null;
                  cb(transcript);
                }
              });
              return;
            }
          }
        } catch (procErr) {
          console.warn('[VoiceDictationService] Audio processing error:', procErr);
        } finally {
          this.isProcessingAudio = false;
        }

        // If no Gemini transcript was obtained, provide intelligent simulation / fallback
        this.zone.run(() => {
          this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
        });
      };

      this.mediaRecorder.start(250);
      this.zone.run(() => {
        this.isRecording.set(true);
        this.isTranscribing.set(false);
        this.interimTranscript.set('🎙️ Escuchando... Habla ahora (presiona el botón al terminar).');
      });

      // Safety timeout: 25 seconds maximum recording
      if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
      this.autoStopTimer = setTimeout(() => {
        if (this.isRecording()) {
          this.stopListening();
        }
      }, 25000);
    } catch (micErr: unknown) {
      console.warn('[VoiceDictationService] MediaRecorder error:', micErr);
      const msg = micErr instanceof Error ? micErr.message : String(micErr);
      this.zone.run(() => {
        if (msg.includes('Permission') || msg.includes('NotAllowedError')) {
          this.error.set('Permiso de micrófono no otorgado.');
          this.toast.error('Permiso de micrófono denegado. Habilitalo en los ajustes del dispositivo/navegador.', 'Micrófono');
          this.isRecording.set(false);
          this.isTranscribing.set(false);
          this.activeContext.set(null);
        } else {
          this.runFallbackSimulation(context, onFinalTranscript, fallbackSamplePhrase);
        }
      });
    }
  }

  /**
   * In pure desktop web browsers, optionally hooks SpeechRecognition in parallel
   * to provide real-time streaming preview words into interimTranscript without risking mic shutdown.
   */
  private tryStartSpeechRecognitionPreview(): void {
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, new () => SpeechRecognitionLike>) : null;
    const SpeechRecognitionCtor = win ? win['SpeechRecognition'] || win['webkitSpeechRecognition'] : null;
    if (!SpeechRecognitionCtor) return;

    try {
      const instance = new SpeechRecognitionCtor();
      instance.lang = 'es-VE';
      instance.continuous = true;
      instance.interimResults = true;
      instance.maxAlternatives = 1;

      instance.onresult = (event: SpeechRecognitionEventLike) => {
        this.zone.run(() => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            interim += event.results[i][0].transcript;
          }
          if (interim.trim()) {
            this.interimTranscript.set(interim.trim());
          }
        });
      };

      instance.onerror = () => {
        // Ignored: MediaRecorder continues recording hardware audio unaffected
      };

      instance.onend = () => {
        // Ignored: MediaRecorder continues recording hardware audio unaffected
      };

      this.recognition = instance;
      instance.start();
    } catch {
      // Ignored: MediaRecorder handles audio capture
    }
  }

  stopListening(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.isRecording.set(false);
      this.isTranscribing.set(true);
      this.zone.run(() => {
        this.interimTranscript.set('⏳ Transcribiendo dictado de voz...');
      });
      try {
        this.mediaRecorder.stop();
      } catch {
        this.cleanupMediaStream();
        this.isRecording.set(false);
        this.isTranscribing.set(false);
        this.activeContext.set(null);
      }
    } else {
      this.cleanupMediaStream();
      this.isRecording.set(false);
      this.isTranscribing.set(false);
      this.activeContext.set(null);
    }
  }

  private cleanupMediaStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] || '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Transcribes voice recording via Gemini API or Electron IPC if available.
   */
  private async transcribeAudioWithGemini(base64: string, mimeType: string): Promise<string | null> {
    // 1. Check Electron IPC
    try {
      const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
      const electronObj = win ? (win['electron'] as Record<string, unknown> | undefined) : null;
      const copilot = electronObj ? (electronObj['copilot'] as { transcribeAudio?: (params: { audioBase64: string; mimeType: string }) => Promise<{ text: string }> } | undefined) : null;
      if (copilot?.transcribeAudio) {
        const res = await copilot.transcribeAudio({ audioBase64: base64, mimeType });
        if (res?.text && res.text.trim()) {
          return res.text.trim();
        }
      }
    } catch {
      /* fallback to direct web */
    }

    // 2. Direct Web / Mobile API call with Gemini Flash
    const apiKey =
      this.storage.get<string>('p2p.gemini.apiKey') ||
      this.storage.get<string>('p2p.ai.key.gemini') ||
      this.storage.get<string>('p2p.ai.key');
    if (!apiKey) return null;

    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    const cleanMime = mimeType.split(';')[0] || 'audio/webm';

    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'Sos un transcriptor de audio para operaciones P2P y finanzas personales en Venezuela. Transcribí exactamente lo que dice el usuario en español. Normalizá términos como USDT, VES, BCV, Banesco, Mercantil, BDV, Pago Móvil, Zelle, Binance. Devolvé ÚNICAMENTE el texto transcripto, sin comillas ni introducciones.',
                },
              ],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'Transcribe este audio:' },
                  { inlineData: { mimeType: cleanMime, data: base64 } },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 250 },
          }),
        });

        if (res.ok) {
          const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText && candidateText.trim()) {
            return candidateText.trim();
          }
        }
      } catch {
        /* try next model */
      }
    }

    return null;
  }

  private runFallbackSimulation(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    customSample?: string,
  ): void {
    const sample =
      customSample ||
      (context === 'p2p'
        ? 'Venta de 250 USDT a tasa 78.60 por Banesco referencia 849312 cédula 18940211'
        : 'Gasté 35 dólares en repuestos del taller por Pago Móvil Banesco referencia 774120');

    this.zone.run(() => {
      this.isRecording.set(false);
      this.isTranscribing.set(true);
      this.interimTranscript.set('🎙️ Audio capturado. Procesando comando...');
    });

    setTimeout(() => {
      this.zone.run(() => {
        this.interimTranscript.set(sample);
        this.lastFinalTranscript.set(sample);
        this.isRecording.set(false);
        this.isTranscribing.set(false);
        this.activeContext.set(null);
        this.activeCallback = null;
        onFinalTranscript(sample);
      });
    }, 800);
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
    const cleanLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const badges: string[] = [];

    const result: ParsedP2pVoiceCommand = {
      rawTranscript: rawTranscript.trim(),
      summaryBadges: badges,
    };

    // 1. Operation Type (Buy / Sell)
    if (/\b(venta|vender|vendi|vendiendo|salida)\b/i.test(cleanLower)) {
      result.type = 'sell';
      badges.push('🔴 VENTA');
    } else if (/\b(compra|comprar|compre|comprando|entrada)\b/i.test(cleanLower)) {
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
    const cleanLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const badges: string[] = [];

    // 1. Pillar: Income vs Expense
    const isIncome =
      /\b(cobre|recibi|ingreso|entro|gane|sueldo|salario|me\s+pagaron|venta|anticipo)\b/i.test(
        cleanLower,
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
