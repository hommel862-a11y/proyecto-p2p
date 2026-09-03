import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_PIPES } from '../../core/format';
import { CounterpartyService } from '../../core/counterparty.service';
import { AccountsService } from '../../core/accounts.service';
import {
  clampNonNegative,
  type Operation,
  type AccountUsage,
  type AntiTriangulationAssessment,
} from '@p2p/core';

export type OpDraft = Omit<Operation, 'id' | 'timestamp'>;

@Component({
  selector: 'app-operation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FORMAT_PIPES],
  template: `
    <div class="section-group">
      <span class="section-eyebrow">Nueva Operación</span>
      <form class="grid ledger-form" (submit)="$event.preventDefault(); onSubmitForm()">
        <label>
          <span>Tipo de Operación</span>
          <select [value]="form().type" (change)="onFieldChange('type', $any($event.target).value)">
            <option value="buy">Compra (VES → Cripto)</option>
            <option value="sell">Venta (Cripto → VES)</option>
          </select>
        </label>
        <label>
          <span>Par Comercial</span>
          <select [value]="form().pair" (change)="onFieldChange('pair', $any($event.target).value)">
            <option value="USDT">USDT/VES</option>
            <option value="EUR">EUR/VES</option>
          </select>
        </label>
        <label>
          <span>Monto en VES</span>
          <input
            type="number"
            min="0"
            step="0.01"
            [value]="form().vesAmount"
            (input)="onFieldChange('vesAmount', clampMoney(+$any($event.target).value))"
          />
        </label>
        <label>
          <span>Monto en {{ form().pair }}</span>
          <input
            type="number"
            min="0"
            step="0.000001"
            [value]="form().usdtAmount"
            (input)="onFieldChange('usdtAmount', clampMoney(+$any($event.target).value))"
          />
        </label>
        <label>
          <span>Precio Pactado (VES/{{ form().pair }})</span>
          <input
            type="number"
            min="0"
            step="0.01"
            [value]="form().price"
            (input)="onFieldChange('price', clampMoney(+$any($event.target).value))"
          />
        </label>
        <label>
          <span>Comisiones Pagadas (VES)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            [value]="form().fees"
            (input)="onFieldChange('fees', clampMoney(+$any($event.target).value))"
          />
        </label>
        <label>
          <span>Contraparte (Directorio CRM)</span>
          <select
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
        </label>
        <label>
          <span>Titular de Pago (Anti-Triangulación)</span>
          <input
            type="text"
            placeholder="Nombre en comprobante bancario"
            [value]="form().payerName"
            (input)="onFieldChange('payerName', $any($event.target).value)"
          />
        </label>

        @if (antiTriangulation().warning; as warn) {
          <div
            class="grid-col-span-2"
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
            style="padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 8px;"
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

        <label class="grid-col-span-2">
          <span>Notas del Comercio / Referencia</span>
          <input
            type="text"
            placeholder="Ej: Comerciante VIP #12 - Banesco"
            [value]="form().merchantNote"
            (input)="onFieldChange('merchantNote', $any($event.target).value)"
          />
        </label>
        <label class="grid-col-span-2">
          <span>Cuenta Bancaria / Riel de Pago</span>
          <select
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
        </label>

        @if (limitExceededWarning(); as warn) {
          <div
            class="grid-col-span-2"
            style="background: rgba(255, 95, 109, 0.12); border-left: 4px solid var(--danger); padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; color: var(--danger); margin-bottom: 8px;"
            role="alert"
          >
            ⚠️ {{ warn }}
          </div>
        }

        <label class="checkbox-label">
          <input
            type="checkbox"
            [checked]="form().errorFree"
            (change)="onFieldChange('errorFree', $any($event.target).checked)"
          />
          <span>Operación ejecutada sin errores (Escalera de disciplina)</span>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Registrar operación</button>
        </div>
      </form>
    </div>
  `,
})
export class OperationFormComponent {
  readonly crmService = inject(CounterpartyService);
  readonly accountsService = inject(AccountsService);

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
