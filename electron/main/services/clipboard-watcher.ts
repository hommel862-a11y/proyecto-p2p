/**
 * Autonomous Background Clipboard Watcher Service.
 * Monitors the system clipboard for Pago Móvil and bank transfer text,
 * extracts reference, amount, bank and counterparty details via pure regex/OCR,
 * performs instant cross-checks against the SQLite counterparty blacklist,
 * and pushes real-time reactive events to the Angular UI.
 *
 * Privacy by Design: 100% offline, zero cloud leakage, customizable toggle.
 */

import crypto from 'node:crypto';
import { clipboard, BrowserWindow, Notification } from 'electron';
import type { P2PDatabaseService } from '../db/database';
import { parseBankReceiptText } from '../vendor/p2p-core/receipt-ocr';
import type { ClipboardPaymentPayload } from '../../shared/types';

export interface ClipboardReader {
  readText(type?: 'selection' | 'clipboard'): string;
}

export interface ClipboardWatcherConfig {
  pollIntervalMs: number;
  enabled: boolean;
  minConfidence: number;
}

export class ClipboardWatcherService {
  private timer: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastTextHash: string | null = null;
  private lastDetectedPayload: ClipboardPaymentPayload | null = null;
  private config: ClipboardWatcherConfig = {
    pollIntervalMs: 900,
    enabled: true,
    minConfidence: 0.4,
  };
  private clipboardImpl: ClipboardReader;

  constructor(
    private db: P2PDatabaseService,
    private getMainWindow: () => BrowserWindow | null,
    clipboardReader?: ClipboardReader,
    config?: Partial<ClipboardWatcherConfig>,
  ) {
    this.clipboardImpl =
      clipboardReader ||
      ({
        readText: () => {
          try {
            return clipboard?.readText ? clipboard.readText() : '';
          } catch {
            return '';
          }
        },
      } as ClipboardReader);

    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  start(): void {
    this.config.enabled = true;
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.pollClipboard();
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    this.config.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getStatus(): {
    enabled: boolean;
    pollIntervalMs: number;
    lastDetectedReference?: string;
  } {
    return {
      enabled: this.config.enabled,
      pollIntervalMs: this.config.pollIntervalMs,
      lastDetectedReference: this.lastDetectedPayload?.reference,
    };
  }

  getLastDetectedPayload(): ClipboardPaymentPayload | null {
    return this.lastDetectedPayload;
  }

  clearLastDetected(): void {
    this.lastDetectedPayload = null;
  }

  /**
   * Main polling tick. Reads clipboard text, checks hashes, parses receipt patterns,
   * verifies against blacklist, and dispatches IPC event if a valid payment is found.
   */
  async pollClipboard(): Promise<ClipboardPaymentPayload | null> {
    if (!this.config.enabled || this.isPolling) return null;
    this.isPolling = true;

    try {
      let text = '';
      try {
        text = this.clipboardImpl.readText('clipboard')?.trim() ?? '';
      } catch {
        return null;
      }

      if (!text || text.length < 8 || text.length > 3000) return null;

      const hash = crypto.createHash('sha256').update(text).digest('hex');
      if (hash === this.lastTextHash) return null;
      this.lastTextHash = hash;

      // Early filter: skip text without banking/payment heuristics
      if (!this.matchesPaymentHeuristics(text)) return null;

      const parsed = parseBankReceiptText(text);

      const hasValidBank = parsed.bank !== 'UNKNOWN';
      const hasValidRef = !!parsed.reference && !parsed.reference.startsWith('REF-');
      const hasValidAmount = parsed.amount > 0;

      // Must have either a valid bank or amount or detected reference
      if (!hasValidBank && !hasValidRef && !hasValidAmount) return null;
      if (parsed.confidenceScore < this.config.minConfidence && !hasValidRef) return null;

      // Cross-check with local counterparty blacklist in SQLite
      const blacklistMatches = this.db.findBlacklistMatches({
        cedula: parsed.payerId,
        phone: parsed.beneficiaryPhone,
      });

      const isBlacklisted = blacklistMatches.length > 0;
      const blacklistReason = isBlacklisted
        ? blacklistMatches[0].incidentNotes || blacklistMatches[0].fraudCategory
        : undefined;

      const payload: ClipboardPaymentPayload = {
        bank: parsed.bank,
        bankDisplayName: parsed.bankDisplayName,
        reference: parsed.reference,
        amount: parsed.amount,
        currency: parsed.currency,
        payerName: parsed.payerName,
        payerId: parsed.payerId,
        beneficiaryPhone: parsed.beneficiaryPhone,
        timestamp: Date.now(),
        rawText: text,
        confidenceScore: parsed.confidenceScore,
        isBlacklisted,
        blacklistReason,
      };

      this.lastDetectedPayload = payload;

      // Notify renderer via IPC
      const win = this.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('p2p:clipboard-payment-detected', payload);
      }

      // Show native OS notification if window is blurred or minimized
      try {
        if (Notification?.isSupported?.() && win && (!win.isFocused() || win.isMinimized())) {
          new Notification({
            title: isBlacklisted
              ? '⚠️ ALERTA: Pago Móvil Sospechoso (Lista Negra)'
              : 'Pago Móvil Detectado en Portapapeles',
            body: `${payload.amount} ${payload.currency} · Ref: ${payload.reference} (${payload.bankDisplayName})`,
          }).show();
        }
      } catch {
        // Non-fatal if native notification fails
      }

      return payload;
    } finally {
      this.isPolling = false;
    }
  }

  private matchesPaymentHeuristics(text: string): boolean {
    const lower = text.toLowerCase();
    const keywords = [
      'pago movil',
      'pago móvil',
      'pagomovil',
      'transferencia',
      'comprobante',
      'referencia',
      'operacion',
      'operación',
      'banesco',
      'mercantil',
      'bdv',
      'venezuela',
      'provincial',
      'bbva',
      'bancamiga',
      'bancaribe',
      'exterior',
      'nequi',
      'bancolombia',
      'zinli',
      'el dorado',
    ];

    if (keywords.some((k) => lower.includes(k))) return true;

    // Check for "ref:" or "referencia:" followed by digits
    if (/\b(?:ref|referencia)[\s.:#]*[0-9]{4,14}\b/i.test(text)) return true;

    // Check for Venezuelan currency amounts e.g. "1.500,00 Bs"
    if (/\b[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?\s*(?:bs|ves|bsf|usd)\b/i.test(text)) return true;

    return false;
  }
}
