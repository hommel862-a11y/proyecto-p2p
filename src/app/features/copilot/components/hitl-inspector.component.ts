import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { StrategyPlanCard } from '../../../../../electron/shared/types';
import type { TreasurySnapshot } from '../../../core/accounts.service';

@Component({
  selector: 'app-copilot-hitl-inspector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside class="hitl-panel" aria-label="Inspector de Ejecución HITL">
      <!-- Always-visible Apple Pro SUDEBAN Radial Shield (matches Workbench mockup) -->
      <div class="sudeban-aura">
        <div class="sudeban-copy">
          <span class="hitl-eyebrow">ESCUDO SUDEBAN &amp; CAPACIDAD</span>
          <strong class="sudeban-big">
            {{ sudebanPct() !== null ? (sudebanPct()! | number: '1.0-0') + '% Tope' : 'Sin Tope' }}
          </strong>
          <span class="sudeban-sub">
            {{ killSwitchActive() ? 'Killswitch ARMADO' : 'Killswitch desarmado' }}
          </span>
        </div>
        <svg width="48" height="48" viewBox="0 0 46 46" aria-hidden="true" class="sudeban-ring">
          <circle cx="23" cy="23" r="18" fill="none" stroke="color-mix(in srgb, var(--muted) 22%, transparent)" stroke-width="5" />
          <circle
            cx="23"
            cy="23"
            r="18"
            fill="none"
            [attr.stroke]="killSwitchActive() || (sudebanPct() ?? 0) >= 85 ? 'var(--danger)' : 'var(--gold)'"
            stroke-width="5"
            stroke-dasharray="113"
            [attr.stroke-dashoffset]="sudebanRingOffset()"
            stroke-linecap="round"
            transform="rotate(-90 23 23)"
          />
          <text x="23" y="26" text-anchor="middle" fill="var(--text)" font-size="9.5" font-weight="800">
            {{ sudebanPct() !== null ? (sudebanPct()! | number: '1.0-0') + '%' : 'N/D' }}
          </text>
        </svg>
      </div>

      @if (plan(); as p) {
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
            <strong class="kpi-value gold">+{{ p.expectedProfitUsdt.toFixed(2) }} USDT</strong>
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
            {{ executing() ? 'Validando Gatekeeper...' : '✓ Aprobar y Preparar Orden' }}
          </button>
          <button
            type="button"
            class="btn-reject"
            [disabled]="executing() || p.status === 'REJECTED'"
            (click)="rejectPlan.emit(p)"
          >
            Rechazar
          </button>
        </div>
      } @else {
        <div class="empty-inspector">
          <div class="hitl-eyebrow">INSPECTOR HITL EN ESPERA</div>
          <p>Cuando el Copiloto o un Agente proponga un plan táctico, aparecerá aquí con sus barreras Gatekeeper para tu aprobación humana.</p>
        </div>
      }
    </aside>
  `,
  styles: [
    `
      .hitl-panel {
        display: flex;
        flex-direction: column;
        gap: 11px;
        padding: 14px;
        border-radius: var(--radius-lg, 20px);
        border: 1px solid var(--line);
        background: var(--panel);
        color: var(--text);
        font-size: 12px;
        height: 100%;
        overflow-y: auto;
        font-variant-numeric: tabular-nums;
      }
      .sudeban-aura {
        position: relative;
        overflow: hidden;
        background: var(--panel-2);
        border: 1px solid color-mix(in srgb, var(--gold) 32%, var(--line));
        border-radius: 16px;
        padding: 12px 13px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .sudeban-aura::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 88% 12%, color-mix(in srgb, var(--gold) 22%, transparent), transparent 62%);
      }
      .sudeban-copy, .sudeban-ring { position: relative; }
      .sudeban-big { display: block; font-size: 18px; font-weight: 800; color: var(--text); margin-top: 2px; }
      .sudeban-sub { display: block; font-size: 11px; color: var(--muted); }
      .empty-inspector {
        padding: 16px 12px;
        border-radius: 14px;
        border: 1px dashed var(--line-strong);
        background: var(--panel-2);
        color: var(--muted);
        line-height: 1.45;
      }
      .empty-inspector p { margin: 6px 0 0; font-size: 11.5px; }
      .hitl-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }
      .hitl-eyebrow,
      .section-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .hitl-title {
        margin: 2px 0 0;
        font-size: 14px;
        font-weight: 700;
        color: var(--text);
      }
      .hitl-badges {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 999px;
      }
      .badge-live {
        background: color-mix(in srgb, var(--accent) 16%, transparent);
        color: var(--accent);
        border: 1px solid color-mix(in srgb, var(--accent) 36%, transparent);
      }
      .badge-sim {
        background: color-mix(in srgb, var(--gold) 16%, transparent);
        color: var(--gold);
        border: 1px solid color-mix(in srgb, var(--gold) 36%, transparent);
      }
      .icon-close {
        background: var(--panel-2);
        border: 1px solid var(--line-strong);
        color: var(--muted);
        border-radius: 999px;
        padding: 2px 7px;
        cursor: pointer;
      }
      .hitl-route {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--gold);
        padding: 7px 10px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--gold) 10%, var(--panel-2));
        border: 1px solid color-mix(in srgb, var(--gold) 28%, var(--line));
      }
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .kpi-box {
        padding: 9px 10px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .kpi-label {
        font-size: 10px;
        color: var(--muted);
      }
      .kpi-value {
        font-size: 13.5px;
        font-weight: 800;
        color: var(--text);
      }
      .kpi-value.positive {
        color: var(--accent);
      }
      .kpi-value.gold {
        color: var(--gold);
      }
      .breakdown-card,
      .gatekeeper-card,
      .rationale-box {
        padding: 10px 11px;
        border-radius: 12px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .kv-row {
        display: flex;
        justify-content: space-between;
        color: var(--text);
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .check-row {
        display: flex;
        gap: 6px;
        color: var(--accent);
      }
      .check-row.fail {
        color: var(--danger);
        font-weight: 700;
      }
      .error-banner {
        padding: 10px;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--danger) 50%, var(--line));
        background: color-mix(in srgb, var(--danger) 14%, var(--panel-2));
        color: var(--danger);
        line-height: 1.4;
      }
      .error-sub {
        margin-top: 4px;
        font-size: 11px;
        color: var(--text);
      }
      .rationale-box p {
        margin: 0;
        color: var(--muted);
        line-height: 1.45;
      }
      .hitl-actions {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        margin-top: auto;
      }
      .btn-approve {
        padding: 9px 14px;
        border-radius: 999px;
        border: none;
        background: var(--accent);
        color: var(--bg-0);
        font-weight: 800;
        cursor: pointer;
      }
      .btn-approve:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn-reject {
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--danger) 48%, var(--line));
        background: color-mix(in srgb, var(--danger) 12%, var(--panel-2));
        color: var(--danger);
        font-weight: 700;
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

  readonly sudebanPct = computed<number | null>(() => {
    const t = this.treasury();
    if (!t || t.totalDailyLimitVes <= 0) return null;
    return Math.min(100, Math.max(0, (t.totalSpentTodayVes / t.totalDailyLimitVes) * 100));
  });

  readonly sudebanRingOffset = computed(() => {
    const pct = this.sudebanPct() ?? 0;
    return Math.round(113 - (113 * pct) / 100);
  });
}
