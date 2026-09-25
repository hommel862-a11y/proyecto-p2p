import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';

export const CHUNK_RELOAD_STORAGE_KEY = 'p2p_chunk_reload_at';
export const CHUNK_RELOAD_THROTTLE_MS = 15_000;

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);

  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Detect chunk invalidation / dynamic import failures caused by hot builds or deployment updates
    if (this.isChunkLoadError(message)) {
      this.audit.log(
        'SYSTEM_ERROR',
        'Desincronización de bundle detectada (chunk desactualizado)',
        { message, stack },
        'warn',
      );

      if (this.shouldTriggerAutoReload()) {
        console.warn(
          '[GlobalErrorHandler] Chunk desactualizado detectado tras nueva build. Auto-recargando la aplicación...',
        );
        this.recordReloadTimestamp();
        this.reloadPage();
        return;
      }
    }

    // Log internally for enterprise traceability
    this.audit.log('SYSTEM_ERROR', 'Excepción no controlada', { message, stack }, 'error');

    // Notify user non-intrusively via Toast
    this.toast.error(
      message.length > 120 ? `${message.substring(0, 117)}...` : message,
      'Error en el sistema',
    );

    // Log to dev console for local debugging
    console.error('[GlobalErrorHandler]', error);
  }

  isChunkLoadError(message: string): boolean {
    return (
      /Failed to fetch dynamically imported module/i.test(message) ||
      /Importing a module script failed/i.test(message) ||
      /error loading dynamically imported module/i.test(message) ||
      /Loading chunk [\w-]+ failed/i.test(message)
    );
  }

  shouldTriggerAutoReload(): boolean {
    try {
      if (typeof window === 'undefined' || !window.sessionStorage) {
        return false;
      }
      const lastReload = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
      if (!lastReload) {
        return true;
      }
      const elapsed = Date.now() - Number(lastReload);
      return elapsed > CHUNK_RELOAD_THROTTLE_MS;
    } catch {
      return false;
    }
  }

  recordReloadTimestamp(): void {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
      }
    } catch {
      // Storage access may be blocked or restricted
    }
  }

  reloadPage(): void {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }
}
