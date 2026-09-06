import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';
import { CounterpartyService } from './counterparty.service';
import {
  parseBankNotification,
  verifyReconciliation,
  type ParsedBankNotification,
  type ExpectedTradePayment,
  type ReconciliationResult,
} from '@p2p/core';

@Injectable({ providedIn: 'root' })
export class BankNotifierService {
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);
  private readonly crm = inject(CounterpartyService);

  readonly notifications = signal<ParsedBankNotification[]>([]);
  readonly lastReconciliation = signal<ReconciliationResult | null>(null);

  /**
   * Ingest raw notification message (SMS, email, or clipboard paste).
   */
  ingest(rawText: string, expectedOrder?: ExpectedTradePayment): ReconciliationResult {
    const parsed = parseBankNotification(rawText);

    this.notifications.update((prev) => [parsed, ...prev.slice(0, 29)]);

    if (!parsed.isParsed) {
      const failedResult: ReconciliationResult = {
        status: 'UNPARSED_NOTIFICATION',
        isSafeToRelease: false,
        amountDifferenceVes: 0,
        confidencePct: 0,
        message: 'No se reconocieron datos bancarios en el texto ingresado.',
        details: {
          expectedAmountVes: expectedOrder?.expectedAmountVes ?? 0,
          receivedAmountVes: 0,
          expectedPayerId: expectedOrder?.counterpartyId ?? '',
          actualPayerId: '',
          reference: '',
        },
      };
      this.lastReconciliation.set(failedResult);
      this.toast.error(
        'Comprobante bancario no reconocido. Revisar manualmente.',
        'Lectura Fallida',
      );
      return failedResult;
    }

    // Check if payer is in Counterparty CRM
    const matchedCp = this.crm
      .counterparties()
      .find(
        (cp) => cp.documentId.replace(/[^0-9]/g, '') === parsed.senderId.replace(/[^0-9]/g, ''),
      );

    if (matchedCp && matchedCp.reputation === 'BLOCKED') {
      const blockedResult: ReconciliationResult = {
        status: 'TRIANGULATION_ALERT',
        isSafeToRelease: false,
        amountDifferenceVes: 0,
        confidencePct: 0,
        message: `🚨 ALERTA CRÍTICA: El pagador (${parsed.senderId}) está en tu LISTA NEGRA de estafas/triangulación (${matchedCp.alias}).`,
        details: {
          expectedAmountVes: expectedOrder?.expectedAmountVes ?? 0,
          receivedAmountVes: parsed.amountVes,
          expectedPayerId: expectedOrder?.counterpartyId ?? '',
          actualPayerId: parsed.senderId,
          reference: parsed.reference,
        },
      };
      this.lastReconciliation.set(blockedResult);
      this.audit.log(
        'SECURITY_ALERT',
        `Intento de pago desde cédula bloqueada en CRM: ${parsed.senderId} (${matchedCp.alias})`,
      );
      this.toast.error(blockedResult.message, 'PAGADOR BLOQUEADO');
      return blockedResult;
    }

    if (expectedOrder) {
      const result = verifyReconciliation(parsed, expectedOrder);
      this.lastReconciliation.set(result);

      if (result.status === 'VERIFIED_SAFE') {
        this.toast.success(result.message, 'Abono 100% Verificado');
        this.audit.log(
          'DATA_MUTATION',
          `Pago verificado: ${parsed.amountVes} Bs en ${parsed.bankName} (Ref: ${parsed.reference}). Cédula: ${parsed.senderId}`,
        );
      } else if (result.status === 'TRIANGULATION_ALERT') {
        this.toast.error(result.message, '¡PELIGRO DE TRIANGULACIÓN!');
        this.audit.log(
          'SECURITY_ALERT',
          `Posible triangulación detectada en orden ${expectedOrder.orderId}: esperada cédula ${expectedOrder.counterpartyId}, recibida ${parsed.senderId}`,
        );
      } else {
        this.toast.error(result.message, 'Discrepancia en el Pago');
      }

      return result;
    }

    // Default reconciliation when no active order was explicitly paired
    const standaloneResult: ReconciliationResult = {
      status: 'VERIFIED_SAFE',
      isSafeToRelease: true,
      amountDifferenceVes: 0,
      confidencePct: 80,
      message: `Abono de ${parsed.amountVes} Bs registrado en ${parsed.bankName} (Ref: ${parsed.reference || 'N/A'}, Cédula: ${parsed.senderId || 'N/A'}).`,
      details: {
        expectedAmountVes: parsed.amountVes,
        receivedAmountVes: parsed.amountVes,
        expectedPayerId: parsed.senderId,
        actualPayerId: parsed.senderId,
        reference: parsed.reference,
      },
    };

    this.lastReconciliation.set(standaloneResult);
    this.toast.info(standaloneResult.message, 'Notificación Bancaria Procesada');
    return standaloneResult;
  }
}
