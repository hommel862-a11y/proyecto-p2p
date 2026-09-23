import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
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

  constructor() {
    this.initElectronListener();
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
      .catch(() => {});

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
    if (!electron?.clipboard?.toggleWatcher) {
      return false;
    }

    const target = enable ?? !this.isWatcherEnabled();
    const updated = await electron.clipboard.toggleWatcher(target);
    this.isWatcherEnabled.set(updated);

    this.toast.info(
      `Vigilancia del portapapeles ${updated ? 'activada' : 'pausada'}`,
      'Portapapeles',
    );
    return updated;
  }

  destroy(): void {
    if (this.unsubscribeListener) {
      this.unsubscribeListener();
      this.unsubscribeListener = null;
    }
  }
}
