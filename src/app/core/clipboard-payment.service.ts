import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Clipboard } from '@capacitor/clipboard';
import { parseBankReceiptText } from '@p2p/core';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';

export interface ClipboardPaymentPayload {
  bank: string;
  bankDisplayName: string;
  reference: string;
  amount: number;
  currency: 'VES' | 'COP' | 'USD';
  payerName?: string;
  payerId?: string;
  beneficiaryPhone?: string;
  timestamp: number;
  rawText: string;
  confidenceScore: number;
  isBlacklisted?: boolean;
  blacklistReason?: string;
}

@Injectable({ providedIn: 'root' })
export class ClipboardPaymentService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);

  readonly detectedPayment = signal<ClipboardPaymentPayload | null>(null);
  readonly isWatcherEnabled = signal<boolean>(true);
  readonly hasElectronBridge = signal<boolean>(false);

  private unsubscribeListener: (() => void) | null = null;
  private lastScannedHash = '';

  constructor() {
    this.initElectronListener();
    this.initVisibilityListener();
  }

  private initVisibilityListener(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          this.isWatcherEnabled() &&
          !this.hasElectronBridge()
        ) {
          void this.scanClipboard();
        }
      });
    }
  }

  /**
   * Scans mobile/web clipboard using @capacitor/clipboard and extracts Venezuelan payment data.
   */
  async scanClipboard(): Promise<ClipboardPaymentPayload | null> {
    try {
      const { value } = await Clipboard.read();
      if (!value || typeof value !== 'string') {
        return null;
      }
      return this.processRawText(value);
    } catch {
      return null;
    }
  }

  /**
   * Parses raw receipt text from clipboard and triggers onPaymentDetected if valid.
   */
  processRawText(text: string): ClipboardPaymentPayload | null {
    if (!text || text.trim().length < 15) {
      return null;
    }

    const quickHash = text.slice(0, 40) + text.length;
    if (quickHash === this.lastScannedHash) {
      return null;
    }

    const parsed = parseBankReceiptText(text);
    if (!parsed || parsed.amount <= 0 || !parsed.reference) {
      return null;
    }

    this.lastScannedHash = quickHash;

    const ts =
      typeof parsed.timestamp === 'number'
        ? parsed.timestamp
        : typeof parsed.timestamp === 'string'
          ? Date.parse(parsed.timestamp) || Date.now()
          : Date.now();

    const payload: ClipboardPaymentPayload = {
      bank: parsed.bank,
      bankDisplayName: parsed.bankDisplayName || parsed.bank.toUpperCase(),
      reference: parsed.reference,
      amount: parsed.amount,
      currency: (parsed.currency as 'VES' | 'COP' | 'USD') || 'VES',
      payerName: parsed.payerName,
      payerId: parsed.payerId,
      beneficiaryPhone: parsed.beneficiaryPhone,
      timestamp: ts,
      rawText: text,
      confidenceScore: parsed.confidenceScore || 85,
      isBlacklisted: false,
    };

    this.onPaymentDetected(payload);
    return payload;
  }

  private initElectronListener(): void {
    const electron = (globalThis as any).electron;
    if (!electron?.clipboard?.onPaymentDetected) {
      return;
    }

    this.hasElectronBridge.set(true);

    // Query initial status
    electron.clipboard
      .getWatcherStatus?.()
      .then((status: { enabled?: boolean }) => {
        if (typeof status?.enabled === 'boolean') {
          this.isWatcherEnabled.set(status.enabled);
        }
      })
      .catch(() => undefined);

    // Listen for payment events
    this.unsubscribeListener = electron.clipboard.onPaymentDetected(
      (payload: ClipboardPaymentPayload) => {
        this.onPaymentDetected(payload);
      },
    );
  }

  onPaymentDetected(payload: ClipboardPaymentPayload): void {
    this.detectedPayment.set(payload);

    this.audit.log(
      payload.isBlacklisted ? 'SECURITY_ALERT' : 'DATA_MUTATION',
      'CLIPBOARD_PAYMENT_DETECTED',
      `Pago Móvil detectado en portapapeles: ${payload.amount} ${payload.currency}, Ref: ${payload.reference} (${payload.bankDisplayName}). Blacklisted: ${payload.isBlacklisted ? 'SI (' + payload.blacklistReason + ')' : 'NO'}`,
      payload.isBlacklisted ? 'error' : 'info',
    );

    if (payload.isBlacklisted) {
      this.toast.error(
        `Contraparte en lista negra detectada: ${payload.payerName || payload.payerId || 'Desconocido'}. Motivo: ${payload.blacklistReason || 'Fraude'}`,
        'ALERTA DE SEGURIDAD',
      );
    } else {
      this.toast.info(
        `Pago Móvil: ${payload.amount} ${payload.currency} · Ref: ${payload.reference} (${payload.bankDisplayName})`,
        'Portapapeles Detectado',
      );
    }
  }

  dismiss(): void {
    this.detectedPayment.set(null);
  }

  loadIntoOperations(payload: ClipboardPaymentPayload): void {
    this.dismiss();
    // Navigate to operation log passing query params for pre-filling
    void this.router.navigate(['/log'], {
      queryParams: {
        autoFillAmount: payload.amount,
        autoFillRef: payload.reference,
        autoFillBank: payload.bankDisplayName,
        autoFillPayer: payload.payerName || '',
        autoFillPayerId: payload.payerId || '',
      },
    });
  }

  async toggleWatcher(enable?: boolean): Promise<boolean> {
    const electron = (globalThis as any).electron;
    if (electron?.clipboard?.toggleWatcher) {
      const target = enable ?? !this.isWatcherEnabled();
      const updated = await electron.clipboard.toggleWatcher(target);
      this.isWatcherEnabled.set(updated);
      this.toast.info(
        `Vigilancia del portapapeles ${updated ? 'activada' : 'pausada'}`,
        'Portapapeles',
      );
      return updated;
    }

    const target = enable ?? !this.isWatcherEnabled();
    this.isWatcherEnabled.set(target);
    if (target) {
      void this.scanClipboard();
    }
    this.toast.info(
      `Vigilancia del portapapeles ${target ? 'activada' : 'pausada'}`,
      'Portapapeles',
    );
    return target;
  }

  destroy(): void {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
    }
  }
}
