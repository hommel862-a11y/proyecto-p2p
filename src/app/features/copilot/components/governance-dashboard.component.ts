import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type {
  CopilotUsageSummaryDto,
  StrategyPlanCard,
} from '../../../../../electron/shared/types';
import type {
  AgentHealthStatusDto,
  AlphaWatcherStatusDto,
  EngramObservationDto,
} from '../models/copilot.models';

@Component({
  selector: 'app-copilot-governance-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="gov-dashboard" aria-label="Dashboard de Inteligencia y Gobernanza IA">
      <!-- Top 4 KPI Cards -->
      <section class="kpi-strip">
        <div class="kpi-card">
          <span class="kpi-eyebrow">SPREAD CAPTURADO (PLANES EJECUTADOS)</span>
          <strong class="kpi-big positive">+{{ capturedProfitUsdt() | number: '1.2-2' }} USDT</strong>
          <span class="kpi-sub">{{ executedCount() }} orden(es) aprobadas/ejecutadas</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-eyebrow">BLOQUEOS DE RIESGO (GATEKEEPER)</span>
          <strong class="kpi-big warn">{{ rejectedCount() }} Detenidas</strong>
          <span class="kpi-sub">
            Killswitch: {{ killSwitchActive() ? 'ARMADO' : 'Inactivo' }}
          </span>
        </div>

        <div class="kpi-card">
          <span class="kpi-eyebrow">LATENCIA P95 Y CACHÉ SEMÁNTICA</span>
          <strong class="kpi-big cyan">
            {{ usageSummary()?.p95LatencyMs !== null && usageSummary()?.p95LatencyMs !== undefined ? usageSummary()!.p95LatencyMs + ' ms' : 'Sin dato' }}
          </strong>
          <span class="kpi-sub">
            {{ usageSummary()?.cachedCalls ?? 0 }} hits de caché / {{ usageSummary()?.totalCalls ?? 0 }} llamadas
          </span>
        </div>

        <div class="kpi-card">
          <span class="kpi-eyebrow">CONSUMO IA (24H)</span>
          <strong class="kpi-big">\${{ (usageSummary()?.totalCostUsd ?? 0) | number: '1.4-4' }} USD</strong>
          <span class="kpi-sub">
            {{ ((usageSummary()?.totalTokensIn ?? 0) + (usageSummary()?.totalTokensOut ?? 0)) | number }} tokens · {{ activeModel() }}
          </span>
        </div>
      </section>

      <!-- 4-Quadrant Main Grid -->
      <section class="quad-grid">
        <!-- Quadrant A: Tactical Plans Queue -->
        <article class="quad-card">
          <header class="quad-header">
            <h4>A. COLA DE PLANES TÁCTICOS Y AUDITORÍA HITL</h4>
            <span class="pill-count">{{ plans().length }} registros</span>
          </header>
          <div class="table-wrap">
            @if (plans().length === 0) {
              <p class="empty-msg">Sin planes tácticos registrados aún (Zero-Seed limpio).</p>
            } @else {
              <table class="audit-table">
                <thead>
                  <tr>
                    <th>Estrategia</th>
                    <th>Spread</th>
                    <th>Origen</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of plans().slice(0, 8); track p.id) {
                    <tr>
                      <td class="cell-title" [title]="p.route">{{ p.title }}</td>
                      <td class="mono positive">+{{ p.expectedNetSpreadPct.toFixed(2) }}%</td>
                      <td>
                        <span class="tag" [class.tag-live]="p.esSimulado === false">
                          {{ p.esSimulado === false ? 'LIVE' : 'SIM' }}
                        </span>
                      </td>
                      <td class="mono">{{ p.status }}</td>
                      <td class="actions-cell">
                        <button type="button" class="btn-mini" (click)="inspectPlan.emit(p)">
                          Ver
                        </button>
                        @if (p.status === 'PROPOSED') {
                          <button type="button" class="btn-mini reject" (click)="rejectPlan.emit(p)">
                            ✕
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </article>

        <!-- Quadrant B: Real-time Watcher & Agent Health -->
        <article class="quad-card">
          <header class="quad-header">
            <h4>B. SALUD DE AGENTES Y WATCHERS EN TIEMPO REAL</h4>
            <button type="button" class="btn-mini" (click)="toggleWatcher.emit()">
              {{ watcherStatus().enabled ? 'Pausar Watcher' : 'Activar Watcher' }}
            </button>
          </header>
          <div class="health-list">
            <div class="health-row">
              <div>
                <strong>Alpha Watcher (30s Binance Book)</strong>
                <div class="health-sub">Escaneos: {{ watcherStatus().scanCount }} · Min Spread: {{ watcherStatus().minNetSpreadPct }}%</div>
              </div>
              <span class="tag" [class.tag-live]="watcherStatus().enabled">
                {{ watcherStatus().enabled ? 'ACTIVO' : 'PAUSADO' }}
              </span>
            </div>
            @for (agent of swarmHealth(); track agent.role) {
              <div class="health-row">
                <div>
                  <strong>{{ agent.name }}</strong>
                  <div class="health-sub">Ops reales: {{ agent.opsProcessed }} · {{ agent.role }}</div>
                </div>
                <span class="tag tag-live">{{ agent.status }}</span>
              </div>
            }
            @if (swarmHealth().length === 0) {
              <p class="empty-msg">Sin telemetría de enjambre en modo web (requiere Electron IPC).</p>
            }
          </div>
        </article>

        <!-- Quadrant C: Engram Memory Quarantine -->
        <article class="quad-card">
          <header class="quad-header">
            <h4>C. GOBERNANZA DE MEMORIA (CUARENTENA ENGRAM)</h4>
            <span class="pill-count warn">{{ quarantinedObs().length }} en cuarentena</span>
          </header>
          <div class="quarantine-split">
            <div class="sub-head">Pendientes de Aprobación Humana (no inyectadas al prompt)</div>
            @if (quarantinedObs().length === 0) {
              <p class="empty-msg">Sin observaciones en cuarentena.</p>
            } @else {
              @for (obs of quarantinedObs().slice(0, 5); track obs.id ?? obs.topicKey) {
                <div class="quarantine-item">
                  <div class="q-text">
                    <strong>{{ obs.what }}</strong>
                    <span>{{ obs.learned }}</span>
                  </div>
                  @if (obs.id !== undefined) {
                    <div class="q-actions">
                      <button
                        type="button"
                        class="btn-mini approve"
                        (click)="reviewEngram.emit({ id: obs.id!, action: 'approve' })"
                      >
                        Aprobar
                      </button>
                      <button
                        type="button"
                        class="btn-mini reject"
                        (click)="reviewEngram.emit({ id: obs.id!, action: 'discard' })"
                      >
                        Descartar
                      </button>
                    </div>
                  }
                </div>
              }
            }
            <div class="sub-head">Reglas Verificadas Activas ({{ activeObs().length }})</div>
            @for (act of activeObs().slice(0, 3); track act.id ?? act.topicKey) {
              <div class="active-rule">✓ {{ act.what }}</div>
            }
          </div>
        </article>

        <!-- Quadrant D: Model Routing & Vault Security -->
        <article class="quad-card">
          <header class="quad-header">
            <h4>D. ENRUTAMIENTO DE MODELOS Y BÓVEDA</h4>
            <button type="button" class="btn-mini" (click)="openAiConfig.emit()">
              Configurar API
            </button>
          </header>
          <div class="routing-stack">
            <div class="route-step primary">
              <span>1. Proveedor Activo: <strong>{{ activeProvider().toUpperCase() }}</strong></span>
              <span class="mono">{{ activeModel() }}</span>
            </div>
            <div class="route-step">
              <span>2. Failover Automático:</span>
              <span class="mono">gemini-4-argon → gemini-3.5-flash-lite</span>
            </div>
            <div class="route-step">
              <span>3. Bóveda de Claves:</span>
              <span class="mono" [class.positive]="isElectron()">
                {{ isElectron() ? 'DPAPI Cifrada (safeStorage)' : 'Solo Sesión Web (0 localStorage)' }}
              </span>
            </div>
            @if ((usageSummary()?.byModel?.length ?? 0) > 0) {
              <div class="sub-head">Desglose por Modelo (24h)</div>
              @for (m of usageSummary()!.byModel; track m.model) {
                <div class="kv-usage">
                  <span class="mono">{{ m.model }} ({{ m.calls }}x)</span>
                  <span class="mono">\${{ m.costUsd | number: '1.4-4' }}</span>
                </div>
              }
            }
          </div>
        </article>
      </section>
    </div>
  `,
  styles: [
    `
      .gov-dashboard {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px;
      }
      .kpi-card,
      .quad-card {
        background: var(--surface-card, #111827);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 12px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .kpi-eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #94a3b8;
      }
      .kpi-big {
        font-family: monospace;
        font-size: 20px;
        color: #f8fafc;
      }
      .kpi-sub {
        font-size: 11px;
        color: #94a3b8;
      }
      .positive {
        color: #10b981;
      }
      .warn {
        color: #f59e0b;
      }
      .cyan {
        color: #38bdf8;
      }
      .quad-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      @media (max-width: 1024px) {
        .quad-grid {
          grid-template-columns: 1fr;
        }
      }
      .quad-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding-bottom: 8px;
      }
      .quad-header h4 {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #cbd5e1;
      }
      .pill-count {
        font-size: 11px;
        font-family: monospace;
        color: #94a3b8;
      }
      .audit-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .audit-table th,
      .audit-table td {
        padding: 6px 4px;
        text-align: left;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }
      .cell-title {
        max-width: 170px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mono {
        font-family: monospace;
      }
      .tag {
        font-size: 10px;
        font-family: monospace;
        padding: 2px 5px;
        border-radius: 4px;
        background: rgba(148, 163, 184, 0.14);
        color: #cbd5e1;
      }
      .tag-live {
        background: rgba(16, 185, 129, 0.14);
        color: #10b981;
      }
      .actions-cell {
        display: flex;
        gap: 4px;
      }
      .btn-mini {
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(15, 23, 42, 0.6);
        color: #e2e8f0;
        cursor: pointer;
      }
      .btn-mini.approve {
        border-color: rgba(16, 185, 129, 0.45);
        color: #10b981;
      }
      .btn-mini.reject {
        border-color: rgba(239, 68, 68, 0.45);
        color: #fca5a5;
      }
      .health-list,
      .quarantine-split,
      .routing-stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 12px;
      }
      .health-row,
      .quarantine-item,
      .route-step,
      .kv-usage {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 7px 9px;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .route-step.primary {
        border-color: rgba(16, 185, 129, 0.4);
      }
      .health-sub,
      .sub-head {
        font-size: 11px;
        color: #94a3b8;
      }
      .q-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 11px;
      }
      .q-text span {
        color: #94a3b8;
      }
      .q-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      .active-rule {
        font-size: 11px;
        color: #10b981;
      }
      .empty-msg {
        margin: 6px 0;
        font-size: 12px;
        color: #64748b;
      }
    `,
  ],
})
export class CopilotGovernanceDashboardComponent {
  readonly plans = input<StrategyPlanCard[]>([]);
  readonly watcherStatus = input.required<AlphaWatcherStatusDto>();
  readonly swarmHealth = input<AgentHealthStatusDto[]>([]);
  readonly engramObservations = input<EngramObservationDto[]>([]);
  readonly usageSummary = input<CopilotUsageSummaryDto | null>(null);
  readonly activeProvider = input<string>('gemini');
  readonly activeModel = input<string>('gemini-3.8-flash');
  readonly killSwitchActive = input<boolean>(false);
  readonly isElectron = input<boolean>(false);

  readonly inspectPlan = output<StrategyPlanCard>();
  readonly rejectPlan = output<StrategyPlanCard>();
  readonly toggleWatcher = output<void>();
  readonly reviewEngram = output<{ id: number; action: 'approve' | 'discard' }>();
  readonly openAiConfig = output<void>();

  readonly executedCount = computed(
    () => this.plans().filter((p) => p.status === 'EXECUTED' || p.status === 'APPROVED').length,
  );

  readonly capturedProfitUsdt = computed(() =>
    this.plans()
      .filter((p) => p.status === 'EXECUTED' || p.status === 'APPROVED')
      .reduce((acc, p) => acc + (Number(p.expectedProfitUsdt) || 0), 0),
  );

  readonly rejectedCount = computed(
    () => this.plans().filter((p) => p.status === 'REJECTED').length,
  );

  readonly quarantinedObs = computed(() =>
    this.engramObservations().filter((o) => o.status === 'needs_review'),
  );

  readonly activeObs = computed(() =>
    this.engramObservations().filter((o) => o.status === 'active'),
  );
}
