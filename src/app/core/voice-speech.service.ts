import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { StorageService } from './storage';

const TTS_PREF_KEY = 'p2p.copilot.tts-enabled';
const AUTO_SEND_KEY = 'p2p.copilot.voice-auto-send';

/**
 * Normalizes common spoken abbreviations and phonetic transcription quirks
 * in Venezuelan / Crypto P2P trading so the Copilot understands the exact intention.
 */
export function normalizeVoicePrompt(raw: string): string {
  if (!raw) return '';
  let text = raw.trim();

  const rules: [RegExp, string][] = [
    // Cryptocurrencies and tokens
    [/\b(u\s*e\s*s\s*e\s*d\s*e\s*t\s*e|u\s*s\s*d\s*t|us\s*dt|ted\s*er|tether)\b/gi, 'USDT'],
    [/\b(b\s*t\s*c|bit\s*coin)\b/gi, 'BTC'],
    [/\b(e\s*t\s*h|e\s*t\s*e\s*r\s*e\s*u\s*m|eter)\b/gi, 'ETH'],
    [/\b(u\s*s\s*d\s*c)\b/gi, 'USDC'],
    // Venezuelan Fiat & Central Bank
    [/\b(v\s*e\s*s|v\s*e\s*z|ve\s*ese|bol[ií]vares\s*digitales|bol[ií]vares)\b/gi, 'VES'],
    [/\b(b\s*c\s*v|be\s*ce\s*ve|banco\s*central)\b/gi, 'BCV'],
    // Banking rails
    [/\b(pago\s*m[oó]vil|pagomovil)\b/gi, 'Pago Móvil'],
    [/\b(banesco\s*en\s*l[ií]nea|banesco)\b/gi, 'Banesco'],
    [/\b(mercantil\s*en\s*l[ií]nea|mercantil)\b/gi, 'Mercantil'],
    [/\b(banco\s*de\s*venezuela|bdv)\b/gi, 'BDV'],
    [/\b(bancaribe)\b/gi, 'Bancaribe'],
    [/\b(provincial|bbva)\b/gi, 'Provincial'],
    // Trading and system commands
    [/\b(p\s*2\s*p|pe\s*dos\s*pe)\b/gi, 'P2P'],
    [/\b(kill\s*switch|bot[oó]n\s*rojo|paro\s*de\s*emergencia)\b/gi, 'Kill-Switch'],
    [/\b(centinela|alpha\s*watcher)\b/gi, 'Centinela'],
    [/\b(enjambre|swarm)\b/gi, 'Enjambre'],
    [/\b(spread\s*neto|espred\s*neto|espred)\b/gi, 'spread neto'],
    [/\b(triangulaci[oó]n|arbitraje\s*triangular)\b/gi, 'triangulación'],
  ];

  for (const [pattern, replacement] of rules) {
    text = text.replace(pattern, replacement);
  }

  // Capitalize first letter
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Strips markdown tables, code blocks, bold markers and URLs to prepare
 * conversational executive text suitable for SpeechSynthesis readout.
 */
export function cleanMarkdownForSpeech(md: string): string {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1') // Inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/\|[^\n]+\|/g, '') // Tables
    .replace(/[#*~_>]/g, '') // Headers, emphasis, blockquotes
    .replace(/(?:^|\n)\s*(\d+\.|•)\s+/g, ' ') // List bullets
    .replace(/\n\s*\n/g, '. ') // Paragraphs to periods
    .replace(/\s+/g, ' ')
    .trim();
}

// Minimal type shim for browser SpeechRecognition
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

@Injectable({ providedIn: 'root' })
export class VoiceSpeechService implements OnDestroy {
  private readonly storage = inject(StorageService);

  // Reactive State Signals
  readonly isSupported = signal<boolean>(false);
  readonly isListening = signal<boolean>(false);
  readonly isMediaRecording = signal<boolean>(false);
  readonly recordingSeconds = signal<number>(0);
  readonly interimTranscript = signal<string>('');
  readonly isSpeaking = signal<boolean>(false);
  readonly ttsEnabled = signal<boolean>(this.storage.get<boolean>(TTS_PREF_KEY) ?? true);
  readonly autoSendOnSilence = signal<boolean>(this.storage.get<boolean>(AUTO_SEND_KEY) ?? false);
  readonly lastError = signal<string | null>(null);

  private recognition: SpeechRecognitionInstance | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private onFinalCallback: ((text: string) => void) | null = null;

  // MediaRecorder Local Capture
  private mediaRecorder: MediaRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private recordingInterval: ReturnType<typeof setInterval> | null = null;
  private onAudioDoneCallback: ((result: { base64: string; mimeType: string }) => void) | null =
    null;

  constructor() {
    this.initSpeechRecognition();
  }

  private initSpeechRecognition(): void {
    if (typeof window === 'undefined') return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this.isSupported.set(false);
      return;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'es-VE';

      this.recognition.onstart = () => {
        this.isListening.set(true);
        this.lastError.set(null);
      };

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        const normalizedInterim = normalizeVoicePrompt(interim);
        this.interimTranscript.set(normalizedInterim);

        if (finalChunk) {
          const cleanFinal = normalizeVoicePrompt(finalChunk);
          if (this.onFinalCallback) {
            this.onFinalCallback(cleanFinal);
          }
          if (this.autoSendOnSilence()) {
            this.resetSilenceTimer();
          }
        }
      };

      this.recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (ev.error === 'network') {
          console.warn(
            '[VoiceSpeechService] Google SpeechRecognition API unreachable in this environment (offline/Electron/local).',
          );
          this.lastError.set(null);
          this.isListening.set(false);
          return;
        }
        if (ev.error !== 'no-speech') {
          this.lastError.set(`Error de micrófono: ${ev.error}`);
        }
        this.isListening.set(false);
      };

      this.recognition.onend = () => {
        if (!this.isMediaRecording()) {
          this.isListening.set(false);
          this.interimTranscript.set('');
        }
      };

      this.isSupported.set(true);
    } catch (err) {
      console.warn('[VoiceSpeechService] Error initializing SpeechRecognition:', err);
      this.isSupported.set(false);
    }
  }

  /**
   * Starts capturing hardware microphone audio via native MediaRecorder.
   * Runs 100% locally without Google Speech API network dependencies.
   */
  async startMediaRecording(
    onDone?: (result: { base64: string; mimeType: string }) => void,
  ): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.lastError.set('Tu entorno no soporta captura de micrófono con MediaRecorder.');
      return false;
    }

    if (onDone) {
      this.onAudioDoneCallback = onDone;
    }

    this.stopSpeaking();
    this.audioChunks = [];
    this.recordingSeconds.set(0);
    this.lastError.set(null);

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        const base64 = await this.blobToBase64(audioBlob);
        const cb = this.onAudioDoneCallback;
        this.onAudioDoneCallback = null;
        if (cb) {
          cb({ base64, mimeType });
        }
        this.cleanupMediaStream();
      };

      this.mediaRecorder.start(250);
      this.isMediaRecording.set(true);
      this.isListening.set(true);

      if (this.recordingInterval) clearInterval(this.recordingInterval);
      this.recordingInterval = setInterval(() => {
        this.recordingSeconds.update((s) => s + 1);
      }, 1000);

      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError.set(`Permiso de micrófono denegado: ${msg}`);
      this.isMediaRecording.set(false);
      this.isListening.set(false);
      return false;
    }
  }

  stopMediaRecording(): void {
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.isMediaRecording.set(false);
    this.isListening.set(false);
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
   * Starts listening through microphone. Calls onFinalText whenever chunks are finalized.
   */
  startListening(onFinalText: (text: string) => void): void {
    // If browser doesn't have working SpeechRec, use MediaRecorder directly
    if (!this.recognition) {
      void this.startMediaRecording();
      return;
    }
    if (this.isListening()) return;

    // Stop speaking if the user starts talking
    this.stopSpeaking();

    this.onFinalCallback = onFinalText;
    this.interimTranscript.set('');
    this.lastError.set(null);

    try {
      this.recognition.start();
    } catch (err) {
      console.warn('[VoiceSpeechService] start() error, falling back to MediaRecorder:', err);
      void this.startMediaRecording();
    }
  }

  /**
   * Stops microphone recording (both SpeechRecognition and MediaRecorder).
   */
  stopListening(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.recognition && this.isListening()) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
    }
    this.stopMediaRecording();
    this.isListening.set(false);
    this.interimTranscript.set('');
  }

  toggleListening(onFinalText: (text: string) => void): void {
    if (this.isListening()) {
      this.stopListening();
    } else {
      this.startListening(onFinalText);
    }
  }

  /**
   * Reads text aloud using browser SpeechSynthesis in Spanish.
   */
  speak(text: string): void {
    if (!this.ttsEnabled() || typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    const cleanText = cleanMarkdownForSpeech(text);
    if (!cleanText) return;

    // Truncate spoken text to executive summary (< 280 chars) to prevent endless talking
    const speechSummary = cleanText.length > 320 ? cleanText.slice(0, 317) + '...' : cleanText;

    this.stopSpeaking();

    try {
      const utterance = new SpeechSynthesisUtterance(speechSummary);
      utterance.lang = 'es-ES';
      utterance.rate = 1.05; // Slightly faster professional cadence
      utterance.pitch = 1.0;

      // Select high quality Spanish voice if available
      const voices = window.speechSynthesis.getVoices();
      const esVoice =
        voices.find(
          (v) =>
            v.lang.startsWith('es') &&
            (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Neural')),
        ) || voices.find((v) => v.lang.startsWith('es'));

      if (esVoice) {
        utterance.voice = esVoice;
      }

      utterance.onstart = () => this.isSpeaking.set(true);
      utterance.onend = () => this.isSpeaking.set(false);
      utterance.onerror = () => this.isSpeaking.set(false);

      this.currentUtterance = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[VoiceSpeechService] SpeechSynthesis error:', err);
      this.isSpeaking.set(false);
    }
  }

  stopSpeaking(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    this.isSpeaking.set(false);
    this.currentUtterance = null;
  }

  toggleTts(): void {
    const next = !this.ttsEnabled();
    this.ttsEnabled.set(next);
    if (!next) {
      this.stopSpeaking();
    }
    try {
      this.storage.set(TTS_PREF_KEY, next);
    } catch {
      /* ignore */
    }
  }

  toggleAutoSend(): void {
    const next = !this.autoSendOnSilence();
    this.autoSendOnSilence.set(next);
    try {
      this.storage.set(AUTO_SEND_KEY, next);
    } catch {
      /* ignore */
    }
  }

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      this.stopListening();
    }, 1800);
  }

  ngOnDestroy(): void {
    this.stopListening();
    this.stopSpeaking();
  }
}
