import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClipboardPaymentService } from '../../core/clipboard-payment.service';

@Component({
  selector: 'app-clipboard-payment-banner',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (clipboardService.detectedPayment(); as payment) {
      <aside
        class="clipboard-banner"
        [class.banner-danger]="payment.isBlacklisted"
        role="alert"
        aria-live="assertive"
      >
        <div class="banner-icon-col">
          @if (payment.isBlacklisted) {
            <span class="banner-alert-icon">⚠️</span>
          } @else {
            <span class="banner-bank-icon">💳</span>
          }
        </div>

        <div class="banner-content">
          <div class="banner-header">
            <span class="bank-tag">{{ payment.bankDisplayName || payment.bank }}</span>
            <span class="ref-tag">Ref: {{ payment.reference }}</span>
            @if (payment.isBlacklisted) {
              <span class="blacklist-badge">LISTA NEGRA</span>
            }
          </div>

          <div class="banner-main-row">
            <strong class="amount-val">
              {{ payment.amount | number: '1.2-2' }} {{ payment.currency }}
            </strong>
            @if (payment.payerName) {
              <span class="payer-info">· De: {{ payment.payerName }}</span>
            }
            @if (payment.payerId) {
              <span class="payer-doc">({{ payment.payerId }})</span>
            }
          </div>

          @if (payment.isBlacklisted && payment.blacklistReason) {
            <p class="blacklist-warning">
              Riesgo: {{ payment.blacklistReason }}
            </p>
          }
        </div>

        <div class="banner-actions">
          <button
            type="button"
            class="btn-action-primary"
            (click)="clipboardService.loadIntoOperations(payment)"
            title="Cargar orden pre-armada en Operaciones"
          >
            ⚡ Cargar Orden
          </button>
          <button
            type="button"
            class="btn-action-dismiss"
            (click)="clipboardService.dismiss()"
            title="Descartar comprobante"
          >
            ✕
          </button>
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .clipboard-banner {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 380px;
        max-width: 520px;
        padding: 14px 18px;
        background: rgba(18, 26, 43, 0.95);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(59, 130, 246, 0.4);
        border-radius: 14px;
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
        color: #f1f5f9;
        animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .banner-danger {
        border-color: rgba(239, 68, 68, 0.6);
        background: rgba(35, 14, 18, 0.95);
      }

      .banner-icon-col {
        font-size: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .banner-content {
        flex: 1;
        min-width: 0;
      }

      .banner-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }

      .bank-tag {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
        padding: 2px 7px;
        border-radius: 5px;
      }

      .ref-tag {
        font-size: 12px;
        font-family: monospace;
        color: #94a3b8;
      }

      .blacklist-badge {
        font-size: 10px;
        font-weight: 800;
        background: #ef4444;
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        animation: pulse 1.5s infinite;
      }

      .banner-main-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        flex-wrap: wrap;
      }

      .amount-val {
        font-size: 16px;
        color: #38bdf8;
      }

      .payer-info,
      .payer-doc {
        font-size: 12px;
        color: #cbd5e1;
      }

      .blacklist-warning {
        margin: 4px 0 0 0;
        font-size: 11px;
        color: #fca5a5;
      }

      .banner-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .btn-action-primary {
        background: #2563eb;
        color: #fff;
        border: none;
        padding: 7px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        white-space: nowrap;
      }

      .btn-action-primary:hover {
        background: #1d4ed8;
      }

      .btn-action-dismiss {
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 7px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        transition: background 0.15s ease;
      }

      .btn-action-dismiss:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    `,
  ],
})
export class ClipboardPaymentBannerComponent {
  readonly clipboardService = inject(ClipboardPaymentService);
}
