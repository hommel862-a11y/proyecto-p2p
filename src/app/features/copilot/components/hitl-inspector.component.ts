import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { StrategyPlanCard } from '../../../../../electron/shared/types';
import type { TreasurySnapshot } from '../../../core/accounts.service';

@Component({
  selector: 'app-copilot-hitl-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (plan(); as p) {
      <aside class="hitl-panel" aria-label="Inspector de Ejecución HITL">
        <div class="hitl-head">
          <div>
            <div class="hitl-eyebrow">INSPECTOR DE EJECUCIÓN HITL</div>
            <h3 class="hitl-title">{{ p.title }}</h3>
          </div>
          <div class="hitl-badges">
            <span
              class="badge"
              [class.badge-live]="p.esSimulado === false"
              [class.badge-sim]="p.esSimulado !== false"
            >
              {{ p.esSimulado === false ? 'DATOS REALES' : 'SIMULADO / SIN FEED' }}
            </span>
            <button
              type="button"
              class="icon-close"
              title="Cerrar inspector"
              (click)="closeInspector.emit()"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="hitl-route">{{ p.route }}</div>

        <div class="kpi-grid">
          <div class="kpi-box">
            <span class="kpi-label">Spread Neto</span>
            <strong class="kpi-value positive">+{{ p.expectedNetSpreadPct.toFixed(2) }}%</strong>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Ganancia Est.</span>
            <strong class="kpi-value positive">+{{ p.expectedProfitUsdt.toFixed(2) }} USDT</strong>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Capital</span>
            <strong class="kpi-value">{{ p.capitalRequiredUsdt.toLocaleString('en-US') }} USDT</strong>
          </div>
          <div class="kpi-box">
            <span class="kpi-label">Equivalente VES</span>
            <strong class="kpi-value">
              {{ orderVes() !== null ? (orderVes()! | number: '1.0-0') + ' VES' : 'SIN TASA' }}
            </strong>
          </div>
        </div>

        <div class="breakdown-card">
          <div class="section-label">DESGLOSE CALCULADO POR MOTOR</div>
          <div class="kv-row">
            <span>Tasa Efectiva</span>
            <span class="mono">{{ effectiveRate() !== null ? effectiveRate()!.toFixed(2) + ' VES/USDT' : 'N/D' }}</span>
          </div>
          <div class="kv-row">
            <span>Nivel de Riesgo</span>
            <span class="mono">{{ p.riskLevel }}</span>
          </div>
          <div class="kv-row">
            <span>Estado del Plan</span>
            <span class="mono">{{ p.status }}</span>
          </div>
          <div class="kv-row">
            <span>Impacto Cupo Diario VES</span>
            <span class="mono">
              {{ projectedCapPct() !== null ? projectedCapPct()!.toFixed(1) + '%' : 'Sin tope configurado' }}
            </span>
          </div>
        </div>

        <div class="gatekeeper-card">
          <div class="section-label">BARRERAS DE RIESGO (GATEKEEPER)</div>
          <div class="check-row" [class.fail]="killSwitchActive()">
            <span>{{ killSwitchActive() ? '✕' : '✓' }}</span>
            <span>{{ killSwitchActive() ? 'Killswitch ACTIVO (bloqueado)' : 'Killswitch desactivado' }}</span>
          </div>
          <div class="check-row" [class.fail]="p.esSimulado !== false">
            <span>{{ p.esSimulado === false ? '✓' : '✕' }}</span>
            <span>{{ p.esSimulado === false ? 'Feed Binance P2P verificado en vivo' : 'Plan sin feed en vivo (bloqueado al ejecutar)' }}</span>
          </div>
          <div class="check-row" [class.fail]="isTreasuryBlocked()">
            <span>{{ isTreasuryBlocked() ? '✕' : '✓' }}</span>
            <span>
              {{
                isTreasuryBlocked()
                  ? 'Tesorería VES saturada o sobre el límite diario'
                  : 'Tesorería VES operativa dentro de límites'
              }}
            </span>
          </div>
        </div>

        @if (executionError(); as err) {
          <div class="error-banner" role="alert">
            <strong>BLOQUEO CRÍTICO DE GATEKEEPER:</strong> {{ err }}
            <div class="error-sub">El portapapeles NO fue modificado.</div>
          </div>
        }

        <div class="rationale-box">
          <div class="section-label">SUSTENTO CUANTITATIVO</div>
          <p>{{ p.rationale }}</p>
        </div>

        <div class="hitl-actions">
          <button
            type="button"
            class="btn-approve"
            [disabled]="executing() || p.status === 'REJECTED' || p.status === 'EXECUTED'"
            (click)="approvePlan.emit(p)"
          >
            {{ executing() ? 'Validando Gatekeeper...' : 'Aprobar y Preparar Orden' }}
          </button>
          <button
            type="button"
            class="btn-reject"
            [disabled]="executing() || p.status === 'REJECTED'"
            (click)="rejectPlan.emit(p)"
          >
            Rechazar Plan
          </button>
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .hitl-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
        background: var(--surface-card, #111827);
        font-size: 12px;
        height: 100%;
        overflow-y: auto;
      }
      .hitl-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }
      .hitl-eyebrow,
      .section-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--text-muted, #94a3b8);
      }
      .hitl-title {
        margin: 2px 0 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary, #f8fafc);
      }
      .hitl-badges {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
      }
      .badge-live {
        background: rgba(16, 185, 129, 0.14);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.35);
      }
      .badge-sim {
        background: rgba(245, 158, 11, 0.14);
        color: #f59e0b;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }
      .icon-close {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #94a3b8;
        border-radius: 6px;
        padding: 2px 6px;
        cursor: pointer;
      }
      .hitl-route {
        font-family: monospace;
        font-size: 11px;
        color: #38bdf8;
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(56, 189, 248, 0.08);
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .kpi-box {
        padding: 8px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(15, 23, 42, 0.55);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .kpi-label {
        font-size: 10px;
        color: #94a3b8;
      }
      .kpi-value {
        font-family: monospace;
        font-size: 13px;
        color: #f8fafc;
      }
      .kpi-value.positive {
        color: #10b981;
      }
      .breakdown-card,
      .gatekeeper-card,
      .rationale-box {
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(15, 23, 42, 0.45);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .kv-row {
        display: flex;
        justify-content: space-between;
        color: #cbd5e1;
      }
      .mono {
        font-family: monospace;
      }
      .check-row {
        display: flex;
        gap: 6px;
        color: #10b981;
      }
      .check-row.fail {
        color: #ef4444;
        font-weight: 600;
      }
      .error-banner {
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgba(239, 68, 68, 0.55);
        background: rgba(239, 68, 68, 0.14);
        color: #fca5a5;
        line-height: 1.4;
      }
      .error-sub {
        margin-top: 4px;
        font-size: 11px;
        color: #fecaca;
      }
      .rationale-box p {
        margin: 0;
        color: #cbd5e1;
        line-height: 1.45;
      }
      .hitl-actions {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        margin-top: auto;
      }
      .btn-approve {
        padding: 9px 12px;
        border-radius: 8px;
        border: none;
        background: #10b981;
        color: #042f2e;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-approve:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn-reject {
        padding: 9px 12px;
        border-radius: 8px;
        border: 1px solid rgba(239, 68, 68, 0.45);
        background: transparent;
        color: #fca5a5;
        font-weight: 600;
        cursor: pointer;
      }
      .btn-reject:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
  ],
})
export class CopilotHitlInspectorComponent {
  readonly plan = input<StrategyPlanCard | null>(null);
  readonly parallelRate = input<number | null>(null);
  readonly treasury = input<TreasurySnapshot | null>(null);
  readonly killSwitchActive = input<boolean>(false);
  readonly executing = input<boolean>(false);
  readonly executionError = input<string | null>(null);

  readonly approvePlan = output<StrategyPlanCard>();
  readonly rejectPlan = output<StrategyPlanCard>();
  readonly closeInspector = output<void>();

  readonly effectiveRate = computed(() => {
    const r = this.parallelRate();
    return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null;
  });

  readonly orderVes = computed(() => {
    const p = this.plan();
    const rate = this.effectiveRate();
    if (!p || rate === null) return null;
    return p.capitalRequiredUsdt * rate;
  });

  readonly projectedCapPct = computed(() => {
    const t = this.treasury();
    const ves = this.orderVes();
    if (!t || t.totalDailyLimitVes <= 0) return null;
    const total = t.totalSpentTodayVes + (ves ?? 0);
    return Math.min(999, (total / t.totalDailyLimitVes) * 100);
  });

  readonly isTreasuryBlocked = computed(() => {
    const t = this.treasury();
    if (!t) return false;
    return t.overLimitCount > 0 || t.saturatedCount > 0;
  });
}
