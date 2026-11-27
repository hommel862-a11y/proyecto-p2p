import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import type {
  FxBankDeskProfile,
  FxBankOrderTicket,
  FxExitRailOption,
  FxInterventionBankId,
} from '@p2p/core';

@Component({
  selector: 'app-fx-ticket-inspector',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../styles/_fx-desk-glass-tokens.scss'],
  styles: [
    `
      .inspector-card {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .inspector-head {
        padding: 13px 16px;
        border-bottom: 1px solid var(--fx-line);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .inspector-title {
        font-size: 0.88rem;
        font-weight: 700;
      }
      .inspector-sub {
        font-size: 0.72rem;
        color: var(--fx-muted);
        margin-top: 2px;
      }
      .inspector-body {
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 11px;
        flex: 1;
      }
      .sub-box {
        background: var(--fx-panel-2);
        border: 1px solid var(--fx-line);
        border-radius: 12px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .sub-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.69rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--fx-muted);
      }
      .alloc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 9px;
        border-radius: 8px;
        background: var(--fx-panel);
        border: 1px solid var(--fx-line);
        font-size: 0.74rem;
      }
      .wf-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 0.75rem;
      }
      .wf-total {
        padding-top: 8px;
        margin-top: 2px;
        border-top: 1px dashed var(--fx-line-strong);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.82rem;
        font-weight: 800;
      }
      .rail-select {
        width: 100%;
        min-height: 34px;
        padding: 6px 10px;
        border-radius: 9px;
        border: 1px solid var(--fx-line-strong);
        background: var(--fx-panel);
        color: var(--fx-text);
        font-size: 0.75rem;
        font-weight: 600;
      }
      .rail-select:focus-visible {
        outline: 2px solid var(--fx-accent-2);
        outline-offset: 2px;
      }
      .inspector-compact-btn {
        min-height: 24px;
        padding: 0 8px;
        font-size: 0.68rem;
      }
      .tips-list {
        margin: 0;
        padding-left: 16px;
        font-size: 0.72rem;
        color: var(--fx-muted);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .inspector-actions {
        margin-top: auto;
        display: grid;
        grid-template-columns: 1fr 1.25fr;
        gap: 8px;
        padding-top: 4px;
      }
      .btn-settle {
        min-height: 38px;
        padding: 0 12px;
        border-radius: 10px;
        border: 1px solid color-mix(in srgb, var(--fx-accent) 65%, var(--fx-text));
        background: var(--fx-accent);
        color: var(--fx-bg-0);
        box-shadow: none;
        font-size: 0.77rem;
        font-weight: 800;
        cursor: pointer;
      }
      .btn-settle:disabled {
        opacity: 0.48;
        cursor: not-allowed;
      }
      .btn-settle:focus-visible {
        outline: 2px solid var(--fx-accent-2);
        outline-offset: 2px;
      }
      @media (max-width: 768px) {
        .rail-select,
        .btn-settle,
        .inspector-compact-btn {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    @if (ticket(); as t) {
      <aside class="fx-content-card inspector-card" aria-label="Inspector de Pacto Atómico">
        <header class="inspector-head">
          <div>
            <div class="inspector-title">Inspector Atómico · {{ t.bank.shortName }}</div>
            <div class="inspector-sub">
              {{ t.bank.mechanismLabel }} · {{ t.bank.typicalWindowLabel }}
            </div>
          </div>
          <span
            class="fx-status-chip"
            [class.is-fluid]="t.signalState === 'CONFIRMED_FLUID'"
            [class.is-open]="t.signalState === 'WINDOW_OPEN' || t.signalState === 'STANDBY'"
            [class.is-dry]="t.signalState === 'COOLDOWN_DEPLETED'"
          >
            {{
              t.signalState === 'CONFIRMED_FLUID'
                ? '● Fluido'
                : t.signalState === 'COOLDOWN_DEPLETED'
                  ? '✕ Enfriamiento'
                  : '◎ Listo'
            }}
          </span>
        </header>

        <div class="inspector-body">
          <!-- Aislamiento Multi-Cuenta -->
          <div class="sub-box">
            <div class="sub-label">
              <span>Aislamiento por Cuenta (TRANSFERENCIA)</span>
              <button
                type="button"
                class="fx-ghost-btn inspector-compact-btn"
                (click)="calibrateAccount.emit(t.bank)"
              >
                {{ t.linkedAccountId ? 'Calibrar Saldo' : '+ Vincular Cuenta' }}
              </button>
            </div>

            @if (t.accountAllocations.length > 0) {
              @for (alloc of t.accountAllocations; track alloc.accountId) {
                <div class="alloc-row fx-tabular">
                  <div>
                    <strong>{{ alloc.accountName }}</strong>
                    <div style="font-size: 0.69rem; color: var(--fx-muted)">
                      Disp: Bs. {{ alloc.availableBalanceVes | number: '1.2-2' }}
                    </div>
                  </div>
                  <div style="text-align: right" class="fx-mono">
                    <strong style="color: var(--fx-gold)">\${{ alloc.orderUsd }} USD</strong>
                    <div style="font-size: 0.69rem; color: var(--fx-muted)">
                      −Bs. {{ alloc.totalDebitVes | number: '1.2-2' }}
                    </div>
                  </div>
                </div>
              }
            } @else if (t.linkedAccountName) {
              <div class="alloc-row fx-tabular">
                <span>{{ t.linkedAccountName }}</span>
                <span class="fx-mono">Bs. {{ t.availableBalanceVes | number: '1.2-2' }}</span>
              </div>
            } @else {
              <div style="font-size: 0.73rem; color: var(--fx-muted)">
                Sin cuenta TRANSFERENCIA vinculada. Vinculá una cuenta real para asentar en FIFO.
              </div>
            }
          </div>

          <!-- Selector de Riel de Salida -->
          <div class="sub-box">
            <label class="sub-label" [attr.for]="'rail-select-' + t.bank.id">
              <span>Riel de Salida a USDT</span>
              <span>Fricción total {{ t.totalExitFrictionPct | number: '1.2-2' }}%</span>
            </label>
            <select
              [id]="'rail-select-' + t.bank.id"
              class="rail-select"
              [value]="t.activeExitRail"
              (change)="onRailChange($event, t.bank.id)"
            >
              @for (opt of exitRailOptions(); track opt.id) {
                <option [value]="opt.id">{{ opt.shortLabel }} — {{ opt.label }}</option>
              }
            </select>
          </div>

          <!-- Cascada Contable Exacta (1x Fee + IGTF) -->
          <div class="sub-box fx-tabular">
            <div class="sub-label">
              <span>Cascada Contable Exacta (1x Comisión)</span>
              <span>Múltiplo \${{ t.bank.lotStepUsd }}</span>
            </div>

            <div class="wf-line">
              <span>Lote Óptimo Anti-Rechazo</span>
              <strong class="fx-mono">\${{ t.recommendedOrderUsd | number: '1.0-0' }} USD</strong>
            </div>
            <div class="wf-line">
              <span>Comisión Bancaria ({{ t.effectiveBankFeePct | number: '1.2-2' }}% único)</span>
              <span class="fx-mono" style="color: var(--fx-warn)">
                +Bs. {{ t.estimatedBankFeeVes | number: '1.2-2' }}
              </span>
            </div>
            <div class="wf-line">
              <strong>Débito Exacto en Cuenta</strong>
              <strong class="fx-mono" style="color: var(--fx-gold)">
                Bs. {{ t.estimatedVesDebit | number: '1.2-2' }}
              </strong>
            </div>
            <div class="wf-line">
              <span>IGTF Venezolano ({{ t.igtfPct | number: '1.2-2' }}%)</span>
              <span class="fx-mono" style="color: var(--fx-danger)">
                −\${{ t.estimatedIgtfUsd | number: '1.2-2' }} USD
              </span>
            </div>
            <div class="wf-line">
              <span>Fricción Riel ({{ t.activeExitRailFrictionPct | number: '1.2-2' }}%)</span>
              <span class="fx-mono" style="color: var(--fx-danger)">
                −\${{ t.estimatedRailFeeUsd | number: '1.2-2' }} USD
              </span>
            </div>
            <div class="wf-line">
              <span>Ingreso Neto en Inventario FIFO</span>
              <strong class="fx-mono" style="color: var(--fx-accent-2)">
                {{ t.netUsdtAfterExitRail | number: '1.2-2' }} USDT
              </strong>
            </div>

            <div class="wf-total">
              <span>Utilidad Neta Realizada</span>
              @if (t.projectedNetProfitVes !== null) {
                <span class="fx-mono" style="color: var(--fx-accent)">
                  +Bs. {{ t.projectedNetProfitVes | number: '1.2-2' }} ({{
                    t.projectedNetRoiPct | number: '1.2-2'
                  }}%)
                </span>
              } @else {
                <span style="color: var(--fx-muted)">Sin tasa P2P</span>
              }
            </div>
          </div>

          <!-- Reglas Anti-Bloqueo -->
          <div class="sub-box">
            <div class="sub-label">
              <span>Protocolo Anti-Bloqueo SUDEBAN / WAF</span>
              <span>Cadencia {{ t.bank.antiWafCooldownSec }}s</span>
            </div>
            <ul class="tips-list">
              @for (tip of t.bank.antiBlockTips; track tip) {
                <li>{{ tip }}</li>
              }
            </ul>
          </div>

          @if (t.blockReason) {
            <div
              style="font-size: 0.73rem; color: var(--fx-warn); padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, var(--fx-warn) 12%, transparent)"
            >
              ⚠️ {{ t.blockReason }}
            </div>
          }

          <!-- Acciones Atómicas -->
          <div class="inspector-actions">
            <button
              type="button"
              class="fx-pill-btn"
              (click)="openPortal.emit(t)"
            >
              @if (cooldownSec() > 0) {
                ⏳ WAF {{ cooldownSec() }}s
              } @else {
                🚀 Abrir Portal
              }
            </button>
            <button
              type="button"
              class="btn-settle"
              [disabled]="t.recommendedOrderUsd <= 0 || (!t.linkedAccountId && !simulatorActive())"
              (click)="settleTicket.emit(t)"
            >
              ✓ Liquidar en SQLite
            </button>
          </div>
        </div>
      </aside>
    }
  `,
})
export class FxTicketInspectorComponent {
  readonly ticket = input.required<FxBankOrderTicket | null>();
  readonly exitRailOptions = input.required<readonly FxExitRailOption[]>();
  readonly cooldownSec = input<number>(0);
  readonly simulatorActive = input<boolean>(false);

  readonly openPortal = output<FxBankOrderTicket>();
  readonly settleTicket = output<FxBankOrderTicket>();
  readonly calibrateAccount = output<FxBankDeskProfile>();
  readonly changeExitRail = output<{ bankId: FxInterventionBankId; railId: string }>();

  onRailChange(event: Event, bankId: FxInterventionBankId): void {
    const select = event.target as HTMLSelectElement | null;
    if (select?.value) {
      this.changeExitRail.emit({ bankId, railId: select.value });
    }
  }
}
