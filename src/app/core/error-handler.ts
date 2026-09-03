import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);

  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    // Log internally for enterprise traceability
    this.audit.log(
      'SYSTEM_ERROR',
      'Excepción no controlada',
      { message, stack },
      'error',
    );

    // Notify user non-intrusively via Toast
    this.toast.error(
      message.length > 120 ? `${message.substring(0, 117)}...` : message,
      'Error en el sistema',
    );

    // Log to dev console for local debugging
    console.error('[GlobalErrorHandler]', error);
  }
}
