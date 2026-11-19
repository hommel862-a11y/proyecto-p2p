import { Injectable, signal, computed, NgZone, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type {
  CurrencyCode,
  ExpenseCategory,
  FinanceScope,
  IncomeCategory,
} from './models/finance-360.models';
import type { BankCode } from '@p2p/core';

import { ToastService } from './toast.service';
import { SecureVaultService } from './secure-vault.service';

export const VOICE_DICTATION_STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  TRANSCRIBING: 'transcribing',
  READY: 'ready',
  NO_API_KEY: 'no_api_key',
  ERROR: 'error',
} as const;

export type VoiceDictationStatus =
  (typeof VOICE_DICTATION_STATUS)[keyof typeof VOICE_DICTATION_STATUS];

export const VOICE_FAILURE_REASON = {
  AUDIO_TOO_SHORT: 'audio_too_short',
  NO_API_KEY: 'no_api_key',
  API_FAILED: 'api_failed',
  MIC_UNAVAILABLE: 'mic_unavailable',
  PERMISSION_DENIED: 'permission_denied',
} as const;

export type VoiceFailureReason =
  (typeof VOICE_FAILURE_REASON)[keyof typeof VOICE_FAILURE_REASON];

export interface VoiceTranscriptionOutcome {
  status: 'ok' | 'no_api_key' | 'error';
  transcript?: string;
  reason?: VoiceFailureReason;
  error?: string;
}

export interface VoiceStartResult {
  status: VoiceDictationStatus;
  reason?: VoiceFailureReason;
  error?: string;
}

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

interface ElectronCopilotVoiceBridge {
  transcribeAudio?: (params: {
    audioBase64: string;
    mimeType: string;
  }) => Promise<{ text?: string; error?: string }>;
}

interface ElectronFinance360VoiceBridge {
  aiAnalyze?: (params: {
    prompt: string;
    inlineData: { mimeType: string; data: string };
    temperature?: number;
  }) => Promise<{ success?: boolean; text?: string; output?: string; error?: string } | string>;
}

interface BankPatternRule {
  pattern: RegExp;
  code: BankCode;
  label: string;
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

interface GeminiTranscriptionResponse {
  candidates?: GeminiCandidate[];
}

const VAULT_GEMINI_KEY = 'gemini_api_key';
const MIN_AUDIO_BASE64_LENGTH = 500;
const CANDIDATE_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

const TRANSCRIPTION_SYSTEM_PROMPT =
  'Eres un transcriptor de audio para operaciones P2P y finanzas personales en Venezuela. Transcribe exactamente lo que dice el usuario en español. Normaliza términos como USDT, VES, BCV, Banesco, Mercantil, BDV, Pago Móvil, Zelle y Binance. Devuelve únicamente el texto transcrito, sin comillas ni introducciones.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getElectronVoiceBridges(): {
  copilot: ElectronCopilotVoiceBridge | null;
  finance360: ElectronFinance360VoiceBridge | null;
} {
  if (typeof window === 'undefined') {
    return { copilot: null, finance360: null };
  }
  const winRecord = window as unknown as Record<string, unknown>;
  const electronVal = winRecord['electron'];
  if (!isRecord(electronVal)) {
    return { copilot: null, finance360: null };
  }

  const copilotVal = electronVal['copilot'];
  const f360Val = electronVal['finance360'];

  return {
    copilot: isRecord(copilotVal) ? (copilotVal as ElectronCopilotVoiceBridge) : null,
    finance360: isRecord(f360Val) ? (f360Val as ElectronFinance360VoiceBridge) : null,
  };
}

function normalizeNumericToken(token: string): string {
  const hasDot = token.includes('.');
  const hasComma = token.includes(',');

  if (hasDot && hasComma) {
    const lastDot = token.lastIndexOf('.');
    const lastComma = token.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Venezuelan/Spanish thousands + decimal comma: 1.500,50 -> 1500.50
      return token.replace(/\./g, '').replace(',', '.');
    }
    // US thousands + decimal dot: 1,250.50 -> 1250.50
    return token.replace(/,/g, '');
  }

  if (hasDot) {
    const parts = token.split('.');
    if (parts.length > 2) {
      return parts.join('');
    }
    const [intPart, fracPart] = parts;
    if (fracPart.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart)) {
      return `${intPart}${fracPart}`;
    }
    return token;
  }

  if (hasComma) {
    const parts = token.split(',');
    if (parts.length > 2) {
      return parts.join('');
    }
    const [intPart, fracPart] = parts;
    if (fracPart.length === 3 && intPart.length <= 3 && !/^0+$/.test(intPart)) {
      return `${intPart}${fracPart}`;
    }
    return `${intPart}.${fracPart}`;
  }

  return token;
}

@Injectable({ providedIn: 'root' })
export class VoiceDictationService {
  private readonly zone = inject(NgZone);
  private readonly toast = inject(ToastService);
  private readonly secureVault = inject(SecureVaultService, { optional: true });

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
  readonly status = signal<VoiceDictationStatus>(VOICE_DICTATION_STATUS.IDLE);
  readonly lastOutcome = signal<VoiceTranscriptionOutcome | null>(null);
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
   * Never fabricates expenses or sample transcripts on error or missing credentials.
   */
  async startListening(
    context: 'p2p' | 'finance360',
    onFinalTranscript: (transcript: string) => void,
    _fallbackSamplePhrase?: string,
  ): Promise<VoiceStartResult> {
    if (this.isListening()) {
      this.stopListening();
      return { status: VOICE_DICTATION_STATUS.IDLE };
    }

    this.error.set(null);
    this.lastOutcome.set(null);
    this.interimTranscript.set('');
    this.activeContext.set(context);
    this.activeCallback = onFinalTranscript;

    const isElectron =
      typeof window !== 'undefined' &&
      Boolean((window as unknown as { electron?: unknown }).electron);
    const isNativeMobile = Capacitor.isNativePlatform();

    const startResult = await this.startMediaRecordingCapture();

    if (startResult.status === VOICE_DICTATION_STATUS.RECORDING && !isElectron && !isNativeMobile) {
      this.tryStartSpeechRecognitionPreview();
    }

    return startResult;
  }

  /**
   * Captures audio directly from the device microphone via MediaRecorder.
   */
  private async startMediaRecordingCapture(): Promise<VoiceStartResult> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return this.failCapture(
        VOICE_FAILURE_REASON.MIC_UNAVAILABLE,
        'Micrófono no disponible en este dispositivo o navegador.',
        'No se detectó un micrófono disponible. Puedes escribir el comando manualmente.',
      );
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
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

          this.zone.run(() => {
            this.status.set(VOICE_DICTATION_STATUS.TRANSCRIBING);
            this.interimTranscript.set('Transcribiendo dictado de voz...');
          });

          const outcome = await this.transcribeAudio(base64, mimeType);
          this.zone.run(() => {
            this.isRecording.set(false);
            this.isTranscribing.set(false);
            this.activeContext.set(null);

            if (outcome.status === 'ok' && outcome.transcript) {
              this.lastFinalTranscript.set(outcome.transcript);
              this.interimTranscript.set(outcome.transcript);
              const cb = this.activeCallback;
              this.activeCallback = null;
              if (cb) {
                cb(outcome.transcript);
              }
            } else {
              this.activeCallback = null;
              this.interimTranscript.set('');
            }
          });
        } catch (procErr: unknown) {
          console.warn('[VoiceDictationService] Audio processing error:', procErr);
          this.zone.run(() => {
            this.activeCallback = null;
            this.isRecording.set(false);
            this.isTranscribing.set(false);
            this.activeContext.set(null);
            this.interimTranscript.set('');
            this.status.set(VOICE_DICTATION_STATUS.ERROR);
            this.error.set('Error procesando la grabación de audio.');
            this.toast.warn(
              'No se pudo procesar el audio capturado. Intenta nuevamente o escribe el comando manualmente.',
              'Dictado por voz',
            );
          });
        } finally {
          this.isProcessingAudio = false;
        }
      };

      this.mediaRecorder.start(250);
      this.zone.run(() => {
        this.isRecording.set(true);
        this.isTranscribing.set(false);
        this.status.set(VOICE_DICTATION_STATUS.RECORDING);
        this.interimTranscript.set(
          'Escuchando... Habla ahora y presiona el botón al terminar.',
        );
      });

      if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
      this.autoStopTimer = setTimeout(() => {
        if (this.isRecording()) {
          this.stopListening();
        }
      }, 25000);

      return { status: VOICE_DICTATION_STATUS.RECORDING };
    } catch (micErr: unknown) {
      console.warn('[VoiceDictationService] MediaRecorder error:', micErr);
      const msg = micErr instanceof Error ? micErr.message : String(micErr);
      const isPermissionDenied = msg.includes('Permission') || msg.includes('NotAllowedError');

      if (isPermissionDenied) {
        return this.failCapture(
          VOICE_FAILURE_REASON.PERMISSION_DENIED,
          'Permiso de micrófono no otorgado.',
          'Permiso de micrófono denegado. Habilítalo en los ajustes del dispositivo o navegador.',
          true,
        );
      }

      return this.failCapture(
        VOICE_FAILURE_REASON.MIC_UNAVAILABLE,
        'No se pudo inicializar el micrófono.',
        'No se pudo iniciar la grabación de audio. Puedes escribir el movimiento manualmente.',
      );
    }
  }

  private failCapture(
    reason: VoiceFailureReason,
    errorMessage: string,
    toastMessage: string,
    useErrorToast = false,
  ): VoiceStartResult {
    this.cleanupMediaStream();
    this.zone.run(() => {
      this.isRecording.set(false);
      this.isTranscribing.set(false);
      this.activeContext.set(null);
      this.activeCallback = null;
      this.interimTranscript.set('');
      this.status.set(VOICE_DICTATION_STATUS.ERROR);
      this.error.set(errorMessage);
      this.lastOutcome.set({
        status: 'error',
        reason,
        error: errorMessage,
      });
      if (useErrorToast) {
        this.toast.error(toastMessage, 'Micrófono');
      } else {
        this.toast.warn(toastMessage, 'Dictado por voz');
      }
    });
    return { status: VOICE_DICTATION_STATUS.ERROR, reason, error: errorMessage };
  }

  private tryStartSpeechRecognitionPreview(): void {
    const win =
      typeof window !== 'undefined'
        ? (window as unknown as Record<string, new () => SpeechRecognitionLike>)
        : null;
    const SpeechRecognitionCtor = win
      ? win['SpeechRecognition'] || win['webkitSpeechRecognition']
      : null;
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
        return;
      };

      instance.onend = () => {
        return;
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
        // ignore
      }
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.isRecording.set(false);
      this.isTranscribing.set(true);
      this.status.set(VOICE_DICTATION_STATUS.TRANSCRIBING);
      this.zone.run(() => {
        this.interimTranscript.set('Transcribiendo dictado de voz...');
      });
      try {
        this.mediaRecorder.stop();
      } catch {
        this.cleanupMediaStream();
        this.isRecording.set(false);
        this.isTranscribing.set(false);
        this.activeContext.set(null);
        this.status.set(VOICE_DICTATION_STATUS.IDLE);
      }
    } else {
      this.cleanupMediaStream();
      this.isRecording.set(false);
      this.isTranscribing.set(false);
      this.activeContext.set(null);
      if (this.status() === VOICE_DICTATION_STATUS.RECORDING) {
        this.status.set(VOICE_DICTATION_STATUS.IDLE);
      }
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
   * Transcribes recorded audio via Electron IPC proxy (`copilot.transcribeAudio` or
   * `finance360.aiAnalyze`) or SecureVault-backed Gemini API.
   * Returns explicit structured status (`ok` | `no_api_key` | `error`) and never fabricates data.
   */
  async transcribeAudio(
    base64: string,
    mimeType = 'audio/webm',
  ): Promise<VoiceTranscriptionOutcome> {
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '').trim();
    const cleanMime = mimeType.split(';')[0] || 'audio/webm';

    if (cleanBase64.length <= MIN_AUDIO_BASE64_LENGTH) {
      const errorMsg =
        'El audio grabado es demasiado corto. Mantén la grabación al menos un segundo e intenta de nuevo.';
      return this.recordTranscriptionFailure(
        'error',
        VOICE_FAILURE_REASON.AUDIO_TOO_SHORT,
        errorMsg,
      );
    }

    // 1. Electron Main-Process Proxies (renderer never handles API keys in desktop mode)
    const { copilot, finance360 } = getElectronVoiceBridges();
    const hasElectronVoiceProxy = Boolean(copilot?.transcribeAudio || finance360?.aiAnalyze);

    if (copilot?.transcribeAudio) {
      try {
        const res = await copilot.transcribeAudio({
          audioBase64: cleanBase64,
          mimeType: cleanMime,
        });
        if (res?.text && res.text.trim().length > 0) {
          return this.recordTranscriptionSuccess(res.text.trim());
        }
      } catch (err: unknown) {
        console.warn('[VoiceDictationService] Electron copilot.transcribeAudio failed:', err);
      }
    }

    if (finance360?.aiAnalyze) {
      try {
        const res = await finance360.aiAnalyze({
          prompt: `${TRANSCRIPTION_SYSTEM_PROMPT}\n\nTranscribe este audio:`,
          inlineData: { mimeType: cleanMime, data: cleanBase64 },
          temperature: 0.1,
        });
        const text =
          typeof res === 'string'
            ? res
            : res && typeof res === 'object' && res.success !== false
              ? typeof res.text === 'string'
                ? res.text
                : typeof res.output === 'string'
                  ? res.output
                  : ''
              : '';
        if (text.trim().length > 0) {
          return this.recordTranscriptionSuccess(text.trim());
        }
      } catch (err: unknown) {
        console.warn('[VoiceDictationService] Electron finance360.aiAnalyze failed:', err);
      }
    }

    if (hasElectronVoiceProxy) {
      return this.recordTranscriptionFailure(
        'error',
        VOICE_FAILURE_REASON.API_FAILED,
        'No se pudo transcribir el audio a través del proxy de escritorio. Verifica tu configuración de IA e intenta de nuevo.',
      );
    }

    // 2. Web / Capacitor fallback: SecureVault ONLY (never plaintext StorageService keys)
    const apiKey = (await this.secureVault?.getSecret(VAULT_GEMINI_KEY))?.trim() ?? '';
    if (!apiKey) {
      return this.recordTranscriptionFailure(
        'no_api_key',
        VOICE_FAILURE_REASON.NO_API_KEY,
        'No hay una API key de Gemini configurada en la bóveda segura. Configúrala en Ajustes o escribe el comando manualmente.',
      );
    }

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
            systemInstruction: {
              parts: [{ text: TRANSCRIPTION_SYSTEM_PROMPT }],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  { text: 'Transcribe este audio:' },
                  { inlineData: { mimeType: cleanMime, data: cleanBase64 } },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 250 },
          }),
        });

        if (res.ok) {
          const json = (await res.json()) as GeminiTranscriptionResponse;
          const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText && candidateText.trim().length > 0) {
            return this.recordTranscriptionSuccess(candidateText.trim());
          }
        }
      } catch {
        // Try next candidate model
      }
    }

    return this.recordTranscriptionFailure(
      'error',
      VOICE_FAILURE_REASON.API_FAILED,
      'No se pudo transcribir el dictado por voz con Gemini. Verifica tu conexión o API key e intenta de nuevo.',
    );
  }

  private recordTranscriptionSuccess(transcript: string): VoiceTranscriptionOutcome {
    const outcome: VoiceTranscriptionOutcome = {
      status: 'ok',
      transcript,
    };
    this.status.set(VOICE_DICTATION_STATUS.READY);
    this.error.set(null);
    this.lastOutcome.set(outcome);
    return outcome;
  }

  private recordTranscriptionFailure(
    status: 'no_api_key' | 'error',
    reason: VoiceFailureReason,
    errorMsg: string,
  ): VoiceTranscriptionOutcome {
    const outcome: VoiceTranscriptionOutcome = {
      status,
      reason,
      error: errorMsg,
    };
    this.status.set(
      status === 'no_api_key'
        ? VOICE_DICTATION_STATUS.NO_API_KEY
        : VOICE_DICTATION_STATUS.ERROR,
    );
    this.error.set(errorMsg);
    this.lastOutcome.set(outcome);
    this.toast.warn(errorMsg, 'Dictado por voz');
    return outcome;
  }

  /**
   * Normalizes spoken Spanish numbers and Venezuelan/US separators:
   * - "78 con 60" -> "78.60"
   * - "1.500 bolívares" -> "1500 bolívares"
   * - "1.500,50 bolívares" -> "1500.50 bolívares"
   * - "12.50 dólares" -> "12.50 dólares"
   * - "1,250.50 dólares" -> "1250.50 dólares"
   */
  private normalizeSpokenNumbers(raw: string): string {
    return raw
      .replace(/(\d+)\s+con\s+(\d+)/gi, '$1.$2')
      .replace(/(\d+)\s+punto\s+(\d+)/gi, '$1.$2')
      .replace(/(\d+)\s+coma\s+(\d+)/gi, '$1.$2')
      .replace(/(?<![A-Za-z0-9])(\d+(?:[.,]\d+)+)(?![A-Za-z0-9])/g, (match) =>
        normalizeNumericToken(match),
      );
  }

  /**
   * Semantic NLP Parser for P2P Trading Desk Voice Commands (`es-VE`).
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
      const priceVal = Number.parseFloat(priceMatch[1]);
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
      result.usdtAmount = Number.parseFloat(usdtExplicit[1]);
      badges.push(`💎 ${result.usdtAmount} ${result.pair ?? 'USDT'}`);
    } else {
      const afterDeMatch = normalized.match(
        /(?:compra|venta|compr[eé]|vend[ií])\s+(?:de\s+)?(\d+(?:\.\d+)?)\b/i,
      );
      if (afterDeMatch) {
        result.usdtAmount = Number.parseFloat(afterDeMatch[1]);
        badges.push(`💎 ${result.usdtAmount} USDT`);
      }
    }

    // 5. VES Amount ("23500 bolívares", "15000 bs")
    const vesMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:bol[ií]vares|bs|ves)\b/i);
    if (vesMatch) {
      result.vesAmount = Number.parseFloat(vesMatch[1]);
      badges.push(`🇻🇪 ${result.vesAmount.toLocaleString('es-VE')} Bs`);
    }

    // 6. Bank Detection
    const bankMap: BankPatternRule[] = [
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
   */
  parseFinance360Command(
    rawTranscript: string,
    currentBcvRate = 0,
  ): ParsedFinance360VoiceCommand {
    const normalized = this.normalizeSpokenNumbers(rawTranscript.trim());
    const lower = normalized.toLowerCase();
    const cleanLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const badges: string[] = [];

    // 1. Pillar: Income vs Expense (explicit verb precedence prevents payroll-as-income bug)
    const hasIncomeVerb =
      /\b(cobre|recibi|ingres[oe]|entro|gane|me\s+pagaron|me\s+transfirieron|me\s+depositaron|vendi|facture)\b/i.test(
        cleanLower,
      );
    const hasExpenseVerb =
      /\b(pague|gaste|transferi|di|compre|abone|cancele|envie|retire|desembolse|egreso|gasto)\b/i.test(
        cleanLower,
      );
    const isOutboundPayroll =
      /\b(nomina|ayudante|empleado|empleados|personal|trabajador|trabajadores)\b/i.test(cleanLower);
    const hasStandaloneIncomeNoun =
      /\b(sueldo|salario|venta|anticipo|comision|dividendos|ganancia)\b/i.test(cleanLower);

    let pillar: 'income' | 'expense' = 'expense';
    if (hasIncomeVerb) {
      pillar = 'income';
    } else if (hasExpenseVerb || isOutboundPayroll) {
      pillar = 'expense';
    } else if (hasStandaloneIncomeNoun) {
      pillar = 'income';
    }

    badges.push(pillar === 'income' ? '🟢 INGRESO' : '🔴 GASTO');

    // 2. Currency & Amount
    let currency: CurrencyCode = 'USD';
    if (/\b(bol[ií]vares|bs\.?|ves)\b/i.test(lower)) {
      currency = 'VES';
    } else if (/\b(usdt|tether|cripto|binance)\b/i.test(lower)) {
      currency = 'USDT';
    } else if (/\b(euros?|eur)\b|€/i.test(lower)) {
      currency = 'EUR';
    }

    let amount = 0;
    const explicitCurrSuffix = normalized.match(
      /(\d+(?:\.\d+)?)\s*(?:\$|usd|d[oó]lares|dolares|usdt|tether|bs\.?|ves|bol[ií]vares|euros?|eur|€)(?![A-Za-z])/i,
    );
    const explicitCurrPrefix = normalized.match(
      /(?:us\$|\$|€|(?<![A-Za-z])(?:usdt|usd|bs\.?|ves|eur))\s*(\d+(?:\.\d+)?)/i,
    );

    if (explicitCurrSuffix) {
      amount = Number.parseFloat(explicitCurrSuffix[1]) || 0;
    } else if (explicitCurrPrefix) {
      amount = Number.parseFloat(explicitCurrPrefix[1]) || 0;
    } else {
      const withoutRefs = normalized.replace(/(?:ref(?:erencia)?[:.\s#-]*)\d{4,14}\b/gi, ' ');
      const genericNumMatch = withoutRefs.match(/\b(\d+(?:\.\d+)?)\b/);
      if (genericNumMatch) {
        amount = Number.parseFloat(genericNumMatch[1]) || 0;
      }
    }

    if (amount > 0) {
      badges.push(`💰 ${amount} ${currency}`);
    }

    // 3. Scope (Personal vs Business/Pyme)
    const isBusiness =
      /\b(taller|pyme|negocio|proveedor|insumos|repuesto|repuestos|pintura|latoner[ií]a|n[oó]mina|empleado|empleados|ayudante|trabajador|trabajadores|cliente|obra|presupuesto)\b/i.test(
        lower,
      ) ||
      (pillar === 'expense' && /\b(sueldo|salario|personal)\b/i.test(lower));
    const scope: FinanceScope = isBusiness ? 'business' : 'personal';
    badges.push(scope === 'business' ? '🏢 Pyme / Taller' : '👤 Personal');

    // 4. Category Classification
    let expenseCategory: ExpenseCategory = 'other';
    let incomeCategory: IncomeCategory = 'other';

    if (pillar === 'expense') {
      if (/\b(gasolina|transporte|uber|ridery|yummy|peaje|caucho|aceite)\b/i.test(lower)) {
        expenseCategory = 'transport';
      } else if (
        /\b(mercado|comida|supermercado|almuerzo|cena|farmatodo|bodeg[oó]n)\b/i.test(lower)
      ) {
        expenseCategory = 'groceries';
      } else if (/\b(cashea|cuota)\b/i.test(lower)) {
        expenseCategory = 'cashea_installment';
      } else if (
        /\b(proveedor|insumos|mercanc[ií]a|pintura|materiales|repuesto|repuestos)\b/i.test(lower)
      ) {
        expenseCategory = 'provider_merchandise';
      } else if (
        /\b(n[oó]mina|ayudante|empleado|empleados|trabajador|trabajadores|sueldo|salario|personal)\b/i.test(
          lower,
        )
      ) {
        expenseCategory = 'payroll';
      } else if (/\b(mantenimiento|herramienta|compresor|arreglo|taller)\b/i.test(lower)) {
        expenseCategory = 'maintenance';
      } else if (
        /\b(internet|luz|agua|corpoelec|cantv|fibex|telefon[ií]a|servicio|servicios)\b/i.test(lower)
      ) {
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
    } else if (
      /\b(banesco|mercantil|bdv|bancamiga|provincial|pago\s+m[oó]vil|bol[ií]vares|bs)\b/i.test(lower)
    ) {
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
        /\b(gast[eé]|pagu[eé]|cobr[eé]|recib[ií]|compr[eé]|transfer[ií]|ingreso|gasto|de|en|por|con|usando|mediante|a\s+tasa)\b/gi,
        ' ',
      )
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:\$|usd|d[oó]lares|dolares|usdt|tether|bs\.?|ves|bol[ií]vares|euros?|eur|€)?\b/gi,
        ' ',
      )
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
