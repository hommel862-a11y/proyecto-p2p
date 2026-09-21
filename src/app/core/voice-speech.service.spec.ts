import { TestBed } from '@angular/core/testing';
import {
  VoiceSpeechService,
  normalizeVoicePrompt,
  cleanMarkdownForSpeech,
} from './voice-speech.service';
import { StorageService } from './storage';

describe('VoiceSpeechService & Phonetic Normalizer', () => {
  let service: VoiceSpeechService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [VoiceSpeechService, StorageService],
    });
    service = TestBed.inject(VoiceSpeechService);
  });

  afterEach(() => {
    service.stopListening();
    service.stopSpeaking();
  });

  describe('normalizeVoicePrompt (P2P Phonetic Normalizer)', () => {
    it('normalizes common spoken USDT variations', () => {
      expect(normalizeVoicePrompt('comprar u ese de te en banesco')).toBe(
        'Comprar USDT en Banesco',
      );
      expect(normalizeVoicePrompt('vender usdt por pago movil')).toBe('Vender USDT por Pago Móvil');
      expect(normalizeVoicePrompt('precio de tether')).toBe('Precio de USDT');
    });

    it('normalizes Venezuelan fiat and BCV terminology', () => {
      expect(normalizeVoicePrompt('cuál es la tasa ve ese y be ce ve')).toBe(
        'Cuál es la tasa VES y BCV',
      );
      expect(normalizeVoicePrompt('brecha del banco central')).toBe('Brecha del BCV');
    });

    it('normalizes institutional banking entities', () => {
      expect(normalizeVoicePrompt('arbitraje en mercantil y bdv')).toBe(
        'Arbitraje en Mercantil y BDV',
      );
      expect(normalizeVoicePrompt('transferencia por bancaribe o provincial')).toBe(
        'Transferencia por Bancaribe o Provincial',
      );
    });

    it('normalizes critical trading commands', () => {
      expect(normalizeVoicePrompt('activa el boton rojo')).toBe('Activa el Kill-Switch');
      expect(normalizeVoicePrompt('ejecuta el alpha watcher')).toBe('Ejecuta el Centinela');
      expect(normalizeVoicePrompt('audita el arbitraje triangular y el swarm')).toBe(
        'Audita el triangulación y el Enjambre',
      );
    });

    it('handles empty or blank string gracefully', () => {
      expect(normalizeVoicePrompt('')).toBe('');
      expect(normalizeVoicePrompt('   ')).toBe('');
    });
  });

  describe('cleanMarkdownForSpeech (TTS sanitizer)', () => {
    it('removes markdown formatting, headers, links, and code blocks', () => {
      const markdown = `
### ⚡ Análisis de Mercado
El spread neto es **1.45%** con \`USDT\`.
[Ver Orden](https://example.com)
\`\`\`ts
const x = 10;
\`\`\`
| Banco | Tasa |
|---|---|
| Banesco | 82.5 |
• Veredicto: Operación aprobada.
`;
      const cleaned = cleanMarkdownForSpeech(markdown);
      expect(cleaned).not.toContain('###');
      expect(cleaned).not.toContain('**');
      expect(cleaned).not.toContain('const x = 10');
      expect(cleaned).not.toContain('https://');
      expect(cleaned).toContain('El spread neto es 1.45% con USDT');
      expect(cleaned).toContain('Veredicto: Operación aprobada');
    });

    it('handles empty text', () => {
      expect(cleanMarkdownForSpeech('')).toBe('');
    });
  });

  describe('VoiceSpeechService State', () => {
    it('initializes with expected defaults', () => {
      expect(service.isListening()).toBe(false);
      expect(service.isSpeaking()).toBe(false);
      expect(service.ttsEnabled()).toBe(true);
    });

    it('toggles TTS preference', () => {
      const initial = service.ttsEnabled();
      service.toggleTts();
      expect(service.ttsEnabled()).toBe(!initial);
    });

    it('toggles Auto-Send preference', () => {
      const initial = service.autoSendOnSilence();
      service.toggleAutoSend();
      expect(service.autoSendOnSilence()).toBe(!initial);
    });
  });
});
