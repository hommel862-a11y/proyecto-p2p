import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_PIPES } from '../../core/format';
import { CounterpartyService } from '../../core/counterparty.service';
import { AccountsService } from '../../core/accounts.service';
import { BankNotifierService } from '../../core/bank-notifier.service';
import { ToastService } from '../../core/toast.service';
import {
  clampNonNegative,
  type Operation,
  type AccountUsage,
  type AntiTriangulationAssessment,
} from '@p2p/core';
import {
  buildPagoMovilQrString,
  generateSimpleQrSvg,
  type PagoMovilPayload,
} from '../../core/pago-movil-dispatcher';

export type OpDraft = Omit<Operation, 'id' | 'timestamp'>;

@Component({
  selector: 'app-operation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FORMAT_PIPES],
  template: `
    <div class="terminal-input-card">
      <div class="terminal-card-header">
        <div class="card-header-title">
          <span class="card-icon">⚡</span>
          <span class="card-title">Nueva Operación en Libro Mayor</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button
            type="button"
            class="btn btn-secondary"
            style="font-size: 0.78rem; padding: 4px 10px;"
            (click)="toggleReconciler()"
          >
            📥 {{ showReconciler() ? 'Ocultar Lector' : 'Pegar Comprobante Bancario' }}
          </button>
          @if (form().type === 'buy') {
            <button
              type="button"
              class="btn btn-secondary"
              style="font-size: 0.78rem; padding: 4px 10px; border-color: var(--gold);"
              (click)="toggleQrDispatcher()"
            >
              📲 {{ showQrDispatcher() ? 'Ocultar QR' : 'QR Pago Móvil' }}
            </button>
          }
        </div>
      </div>

      <!-- Panel de Ingesta y Conciliación Pasiva -->
      @if (showReconciler()) {
        <div
          style="background: rgba(10, 15, 26, 0.7); border: 1px solid var(--gold-border); border-radius: var(--radius); padding: 14px; margin-bottom: 8px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;"
          >
            <span
              style="font-size: 0.8rem; font-weight: 700; color: var(--gold-strong); text-transform: uppercase; letter-spacing: 0.5px;"
            >
              Lector Pasivo de Notificaciones (Mercantil, Bancamiga, Banesco, Provincial, BDV, Banplus)
            </span>
            <span class="text-muted" style="font-size: 0.75rem;"
              >Anti-Triangulación en Tiempo Real</span
            >
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input
              type="text"
              placeholder="Pega aquí el SMS o correo del banco (ej: MERCANTIL: Recibiste Pago Movil por Bs. 2.450,00 de CI: V18450123 Ref: 987654)"
              [value]="rawBankNotification()"
              (input)="rawBankNotification.set($any($event.target).value)"
              style="flex: 1; min-width: 260px; font-size: 0.85rem;"
            />
            <button
              type="button"
              class="btn btn-primary"
              (click)="processBankReceipt()"
              style="font-size: 0.82rem; white-space: nowrap;"
            >
              ⚡ Conciliar y Rellenar
            </button>
          </div>

          @if (bankNotifier.lastReconciliation(); as rec) {
            <div
              style="margin-top: 10px; padding: 8px 12px; border-radius: 4px; font-size: 0.82rem;"
              [style.background]="
                rec.status === 'VERIFIED_SAFE'
                  ? 'rgba(52, 211, 153, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)'
              "
              [style.color]="rec.status === 'VERIFIED_SAFE' ? '#34d399' : '#f87171'"
              [style.border-left]="
                rec.status === 'VERIFIED_SAFE' ? '3px solid #34d399' : '3px solid #ef4444'
              "
            >
              {{ rec.message }}
            </div>
          }
        </div>
      }

      <!-- Despachador Asistido de Pago Móvil (Human-in-the-Loop) -->
      @if (showQrDispatcher() && form().type === 'buy') {
        <div
          style="background: rgba(10, 15, 26, 0.7); border: 1px solid rgba(47, 208, 143, 0.35); border-radius: var(--radius); padding: 14px; margin-bottom: 8px;"
        >
          <div
            style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"
          >
            <span
              style="font-size: 0.8rem; font-weight: 700; color: #4ef0a5; text-transform: uppercase; letter-spacing: 0.5px;"
            >
              📲 Despachador QR Pago Móvil
            </span>
            <span class="text-muted" style="font-size: 0.75rem;">Pago sin Digitaciones</span>
          </div>

          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            @if (qrCodeUrl(); as svg) {
              <div
                [innerHTML]="svg"
                style="background: #fff; padding: 8px; border-radius: 6px; display: inline-flex;"
              ></div>
            }
            <div style="display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 220px;">
              <div style="font-size: 0.85rem; color: var(--text-muted);">
                Escanea el código con la app de tu banco o copia los datos al portapapeles con 1
                clic:
              </div>

              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.78rem; padding: 4px 8px;"
                  (click)="
                    copy(selectedCounterparty()?.documentId || form().payerName || '', 'Cédula')
                  "
                >
                  📋 Cédula: {{ selectedCounterparty()?.documentId || form().payerName || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.78rem; padding: 4px 8px;"
                  (click)="copy(selectedCounterparty()?.phone || '', 'Teléfono')"
                >
                  📋 Teléfono: {{ selectedCounterparty()?.phone || 'N/A' }}
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  style="font-size: 0.78rem; padding: 4px 8px;"
                  (click)="copy(form().vesAmount.toFixed(2), 'Monto')"
                >
                  📋 Monto: {{ form().vesAmount | ves }}
                </button>
              </div>
            </div>
          </div>
        </div>
      }

      <form (submit)="$event.preventDefault(); onSubmitForm()">
        <div class="terminal-input-grid grid-3">
          <div class="terminal-field">
            <label class="terminal-label">
              <span>Tipo de Operación</span>
            </label>
            <div class="input-control-wrap">
              <select class="terminal-select" [value]="form().type" (change)="onFieldChange('type', $any($event.target).value)">
                <option value="buy">🟢 Compra (VES → Cripto)</option>
                <option value="sell">🔴 Venta (Cripto → VES)</option>
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Par Comercial</span>
            </label>
            <div class="input-control-wrap">
              <select class="terminal-select" [value]="form().pair" (change)="onFieldChange('pair', $any($event.target).value)">
                <option value="USDT">USDT / VES</option>
                <option value="EUR">EUR / VES</option>
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Precio Pactado</span>
              <span class="terminal-subtext">VES por {{ form().pair }}</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix">VES</span>
              <input
                type="number"
                min="0"
                step="0.01"
                class="terminal-input font-bold"
                [value]="form().price"
                (input)="onFieldChange('price', clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Monto en VES</span>
              <span class="terminal-subtext">Bolívares totales</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix">Bs</span>
              <input
                type="number"
                min="0"
                step="0.01"
                class="terminal-input"
                [value]="form().vesAmount"
                (input)="onFieldChange('vesAmount', clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Monto en {{ form().pair }}</span>
              <span class="terminal-subtext">Volumen cripto</span>
            </label>
            <div class="input-control-wrap">
              <input
                type="number"
                min="0"
                step="0.000001"
                class="terminal-input highlight-gold font-bold"
                [value]="form().usdtAmount"
                (input)="onFieldChange('usdtAmount', clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
              <span class="input-suffix">{{ form().pair }}</span>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Comisiones Pagadas</span>
              <span class="terminal-subtext">Bancos / Red</span>
            </label>
            <div class="input-control-wrap">
              <span class="input-prefix">Bs</span>
              <input
                type="number"
                min="0"
                step="0.01"
                class="terminal-input"
                [value]="form().fees"
                (input)="onFieldChange('fees', clampMoney(+$any($event.target).value))"
                placeholder="0.00"
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Contraparte (CRM)</span>
            </label>
            <div class="input-control-wrap">
              <select
                class="terminal-select"
                [value]="form().counterpartyId"
                (change)="onCounterpartySelect($any($event.target).value)"
              >
                <option value="">Seleccionar del directorio...</option>
                @for (cp of crmService.counterparties(); track cp.id) {
                  <option [value]="cp.id">
                    {{ cp.alias }} ({{ cp.realName }}) [{{ cp.reputation }}]
                  </option>
                }
              </select>
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Titular de Pago</span>
              <span class="terminal-subtext">Anti-Triangulación</span>
            </label>
            <div class="input-control-wrap">
              <input
                type="text"
                class="terminal-input"
                placeholder="Nombre o Cédula en comprobante"
                [value]="form().payerName"
                (input)="onFieldChange('payerName', $any($event.target).value)"
              />
            </div>
          </div>

          <div class="terminal-field">
            <label class="terminal-label">
              <span>Cuenta Bancaria / Riel</span>
            </label>
            <div class="input-control-wrap">
              <select
                class="terminal-select"
                [value]="form().bankAccountId"
                (change)="onFieldChange('bankAccountId', $any($event.target).value)"
              >
                <option value="">Sin asignar / Otra cuenta</option>
                @for (acc of accountsService.accounts(); track acc.id) {
                  <option [value]="acc.id">
                    {{ acc.bankName }} ({{ acc.rail }}) — Límite:
                    {{ acc.dailyLimitVes ? (acc.dailyLimitVes | ves) : 'Ilimitado' }}
                  </option>
                }
              </select>
            </div>
          </div>

          <div class="terminal-field full-width">
            <label class="terminal-label">
              <span>Notas del Comercio / Referencia</span>
            </label>
            <div class="input-control-wrap">
              <input
                type="text"
                class="terminal-input"
                placeholder="Ej: Comerciante VIP #12 - Ref: 987654"
                [value]="form().merchantNote"
                (input)="onFieldChange('merchantNote', $any($event.target).value)"
              />
            </div>
          </div>
        </div>

        @if (antiTriangulation().warning; as warn) {
          <div
            [style.background]="
              antiTriangulation().riskLevel === 'CRITICAL'
                ? 'rgba(255, 95, 109, 0.15)'
                : 'rgba(239, 201, 76, 0.15)'
            "
            [style.border-left]="
              antiTriangulation().riskLevel === 'CRITICAL'
                ? '4px solid var(--danger)'
                : '4px solid var(--gold)'
            "
            [style.color]="
              antiTriangulation().riskLevel === 'CRITICAL' ? 'var(--danger)' : 'var(--gold-strong)'
            "
            style="padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; margin: 12px 0 6px;"
            role="alert"
          >
            <strong>{{
              antiTriangulation().riskLevel === 'CRITICAL'
                ? '🛑 RIESGO CRÍTICO:'
                : '⚠️ ADVERTENCIA:'
            }}</strong>
            {{ warn }}
          </div>
        }

        @if (limitExceededWarning(); as warn) {
          <div
            style="background: rgba(255, 95, 109, 0.12); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; color: var(--danger); margin: 6px 0;"
            role="alert"
          >
            ⚠️ {{ warn }}
          </div>
        }

        <div class="terminal-card-footer" style="padding-top: 14px; margin-top: 10px;">
          <label class="checkbox-label" style="margin: 0;">
            <input
              type="checkbox"
              [checked]="form().errorFree"
              (change)="onFieldChange('errorFree', $any($event.target).checked)"
            />
            <span style="font-size: 0.82rem;">Operación ejecutada sin errores (Escalera de disciplina)</span>
          </label>
          <div class="form-actions" style="margin: 0;">
            <button type="submit" class="btn btn-primary">⚡ Registrar Operación</button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class OperationFormComponent {
  readonly crmService = inject(CounterpartyService);
  readonly accountsService = inject(AccountsService);
  readonly bankNotifier = inject(BankNotifierService);
  private readonly toast = inject(ToastService);

  readonly form = input.required<OpDraft>();
  readonly selectedAccountUsage = input<AccountUsage | null>(null);
  readonly limitExceededWarning = input<string | null>(null);
  readonly antiTriangulation = input<AntiTriangulationAssessment>({
    isSafe: true,
    riskLevel: 'LOW',
    isThirdPartyPayment: false,
  });

  readonly formChange = output<Partial<OpDraft>>();
  readonly counterpartySelect = output<string>();
  readonly submitForm = output<void>();

  readonly showReconciler = signal<boolean>(false);
  readonly showQrDispatcher = signal<boolean>(false);
  readonly rawBankNotification = signal<string>('');

  readonly selectedCounterparty = computed(() => {
    const id = this.form().counterpartyId;
    return id ? this.crmService.getById(id) : null;
  });

  readonly qrCodeUrl = signal<string>('');

  private readonly qrEffect = effect(() => {
    const cp = this.selectedCounterparty();
    const phone = cp?.phone || '04141234567';
    const doc = cp?.documentId || this.form().payerName || 'V12345678';
    const amt = this.form().vesAmount || 100;

    const payload: PagoMovilPayload = {
      bankCode: '0105', // Default Mercantil
      bankName: 'Pago Móvil',
      phone,
      documentId: doc,
      amountVes: amt,
    };

    const qrText = buildPagoMovilQrString(payload);
    void generateSimpleQrSvg(qrText).then((svg) => this.qrCodeUrl.set(svg));
  });

  toggleReconciler(): void {
    this.showReconciler.update((v) => !v);
  }

  toggleQrDispatcher(): void {
    this.showQrDispatcher.update((v) => !v);
  }

  processBankReceipt(): void {
    const raw = this.rawBankNotification().trim();
    if (!raw) {
      this.toast.error('Por favor ingresa el texto del comprobante bancario.', 'Texto Vacío');
      return;
    }

    const cp = this.selectedCounterparty();
    const expected = cp
      ? {
          orderId: 'CURRENT',
          expectedAmountVes: this.form().vesAmount > 0 ? this.form().vesAmount : 0,
          counterpartyId: cp.documentId,
          counterpartyName: cp.realName,
        }
      : undefined;

    const res = this.bankNotifier.ingest(raw, expected);

    if (res.details.receivedAmountVes > 0) {
      const patch: Partial<OpDraft> = {
        vesAmount: res.details.receivedAmountVes,
      };

      if (this.form().price > 0 && this.form().type === 'sell') {
        patch.usdtAmount = Number((res.details.receivedAmountVes / this.form().price).toFixed(6));
      }

      if (res.details.actualPayerId) {
        patch.payerName = res.details.actualPayerId;
      }

      if (res.details.reference) {
        patch.merchantNote = `Ref: ${res.details.reference} (${res.details.actualPayerId || ''})`;
      }

      this.formChange.emit(patch);
    }
  }

  copy(text: string, label: string): void {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      this.toast.info(`${label} copiada al portapapeles: ${text}`, 'Copiado Rápido');
    });
  }

  clampMoney(v: number): number {
    return clampNonNegative(v);
  }

  onFieldChange<K extends keyof OpDraft>(field: K, value: OpDraft[K]): void {
    this.formChange.emit({ [field]: value } as Partial<OpDraft>);
  }

  onCounterpartySelect(id: string): void {
    this.counterpartySelect.emit(id);
  }

  onSubmitForm(): void {
    this.submitForm.emit();
  }
}
