import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type {
  CopilotUsageSummaryDto,
  StrategyPlanCard,
} from '../../../../../electron/shared/types';
import type {
  AgentHealthStatusDto,
  AlphaWatcherStatusDto,
  EngramObservationDto,
} from '../models/copilot.models';

type GovSubTab = 'overview' | 'hitl' | 'swarm' | 'vault';
type PlanStatusFilter = 'ALL' | 'PROPOSED' | 'EXECUTED' | 'REJECTED';

@Component({
  selector: 'app-copilot-governance-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="gov-dashboard" aria-label="Dashboard de Inteligencia y Gobernanza IA">
      <!-- Layer 1: Floating Liquid Glass Command Strip (Finanzas 360 + Apple Pro) -->
      <header class="gov-command-bar ai-liquid-glass">
        <div class="cmd-left">
          <div class="ai-capsule" role="tablist" aria-label="Subvistas del dashboard IA">
            <button
              type="button"
              role="tab"
              class="ai-pill-tab"
              [class.active]="subTab() === 'overview'"
              (click)="subTab.set('overview')"
            >
              ✦ Overview 360
            </button>
            <button
              type="button"
              role="tab"
              class="ai-pill-tab"
              [class.active]="subTab() === 'hitl'"
              (click)="subTab.set('hitl')"
            >
              🛡️ Cola HITL ({{ proposedCount() }})
            </button>
            <button
              type="button"
              role="tab"
              class="ai-pill-tab"
              [class.active]="subTab() === 'swarm'"
              (click)="subTab.set('swarm')"
            >
              🤖 Enjambre & Engram
            </button>
            <button
              type="button"
              role="tab"
              class="ai-pill-tab"
              [class.active]="subTab() === 'vault'"
              (click)="subTab.set('vault')"
            >
              🔐 Modelos & Bóveda
            </button>
          </div>
        </div>

        <div class="cmd-right">
          <input
            type="search"
            class="search-pill"
            placeholder="Filtrar planes o reglas..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
          />
          <button type="button" class="btn-glass" (click)="toggleWatcher.emit()">
            {{ watcherStatus().enabled ? '⏸ Pausar Watcher' : '▶ Activar Watcher' }}
          </button>
          <button type="button" class="btn-glass" (click)="openAiConfig.emit()">
            ⚙ API & Bóveda
          </button>
        </div>
      </header>

      <!-- ROW 1: 4 Hero KPI Bento Cards (Exact Finanzas 360 Anatomy: 3 Sparklines + 1 Radial SVG Ring) -->
      <section class="hero-kpi-grid" aria-label="Indicadores principales del Copiloto IA">
        <!-- 1. GOLD: Spread Capturado & Beneficio -->
        <article class="ai-kpi-aura tone-gold">
          <div class="kpi-head">
            <span class="kpi-label">Spread Capturado</span>
            <span class="kpi-badge ai-tabular">USDT</span>
          </div>
          <div class="kpi-body">
            <div>
              <strong class="kpi-primary ai-tabular positive">
                +{{ capturedProfitUsdt() | number: '1.2-2' }}
              </strong>
              <span class="kpi-secondary ai-tabular">
                {{ executedCount() }} orden(es) aprobadas/ejecutadas
              </span>
            </div>
            <svg class="kpi-spark" viewBox="0 0 112 32" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="copSparkGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--gold)" stop-opacity="0.34" />
                  <stop offset="100%" stop-color="var(--gold)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,26 L20,22 L42,24 L62,14 L84,16 L112,6 L112,32 L0,32 Z" fill="url(#copSparkGold)" />
              <path d="M0,26 L20,22 L42,24 L62,14 L84,16 L112,6" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </article>

        <!-- 2. EMERALD: Consumo IA & Ahorro Caché -->
        <article class="ai-kpi-aura tone-emerald">
          <div class="kpi-head">
            <span class="kpi-label">Consumo IA (24h)</span>
            <span class="kpi-badge ai-tabular">{{ cacheHitRatePct() }}% caché</span>
          </div>
          <div class="kpi-body">
            <div>
              <strong class="kpi-primary ai-tabular">
                \${{ (usageSummary()?.totalCostUsd ?? 0) | number: '1.4-4' }}
              </strong>
              <span class="kpi-secondary ai-tabular">
                {{ ((usageSummary()?.totalTokensIn ?? 0) + (usageSummary()?.totalTokensOut ?? 0)) | number }} tok · {{ activeModel() }}
              </span>
            </div>
            <svg class="kpi-spark" viewBox="0 0 112 32" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="copSparkEm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.34" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,22 L22,19 L44,16 L68,18 L90,9 L112,5 L112,32 L0,32 Z" fill="url(#copSparkEm)" />
              <path d="M0,22 L22,19 L44,16 L68,18 L90,9 L112,5" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </article>

        <!-- 3. VIOLET: Latencia P95 Motor -->
        <article class="ai-kpi-aura tone-violet">
          <div class="kpi-head">
            <span class="kpi-label">Latencia P95 Motor</span>
            <span class="kpi-badge ai-tabular">{{ usageSummary()?.totalCalls ?? 0 }} calls</span>
          </div>
          <div class="kpi-body">
            <div>
              <strong class="kpi-primary ai-tabular">
                {{ usageSummary()?.p95LatencyMs !== null && usageSummary()?.p95LatencyMs !== undefined ? usageSummary()!.p95LatencyMs + ' ms' : 'Sin dato' }}
              </strong>
              <span class="kpi-secondary ai-tabular">
                {{ usageSummary()?.cachedCalls ?? 0 }} hits locales · {{ activeProvider().toUpperCase() }}
              </span>
            </div>
            <svg class="kpi-spark" viewBox="0 0 112 32" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="copSparkViolet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--ai-violet)" stop-opacity="0.34" />
                  <stop offset="100%" stop-color="var(--ai-violet)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,18 L22,20 L44,12 L68,16 L90,10 L112,11 L112,32 L0,32 Z" fill="url(#copSparkViolet)" />
              <path d="M0,18 L22,20 L44,12 L68,16 L90,10 L112,11" fill="none" stroke="var(--ai-violet)" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </article>

        <!-- 4. RADIAL SVG RING: Escudo de Riesgo & Bloqueos Gatekeeper -->
        <article
          class="ai-kpi-aura"
          [class.tone-danger]="killSwitchActive()"
          [class.tone-gold]="!killSwitchActive() && quarantinedObs().length > 0"
          [class.tone-emerald]="!killSwitchActive() && quarantinedObs().length === 0"
        >
          <div class="kpi-head">
            <span class="kpi-label">Escudo & Gatekeeper</span>
            <span class="status-pill" [class.danger]="killSwitchActive()" [class.ok]="!killSwitchActive()">
              {{ killSwitchActive() ? 'KILLSWITCH ARMADO' : 'OPERATIVO' }}
            </span>
          </div>
          <div class="kpi-body">
            <div>
              <strong class="kpi-primary ai-tabular">{{ rejectedCount() }} Detenidas</strong>
              <span class="kpi-secondary ai-tabular">
                {{ quarantinedObs().length }} en cuarentena Engram
              </span>
            </div>
            <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
              <circle cx="23" cy="23" r="18" fill="none" stroke="color-mix(in srgb, var(--muted) 22%, transparent)" stroke-width="5" />
              <circle
                cx="23"
                cy="23"
                r="18"
                fill="none"
                [attr.stroke]="killSwitchActive() ? 'var(--danger)' : 'var(--accent)'"
                stroke-width="5"
                stroke-dasharray="113"
                [attr.stroke-dashoffset]="healthRingDashOffset()"
                stroke-linecap="round"
                transform="rotate(-90 23 23)"
              />
              <text x="23" y="26" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="800">
                {{ approvalHealthPct() }}%
              </text>
            </svg>
          </div>
        </article>
      </section>

      <!-- ROW 2: Interactive Bento Grid (Filtered by SubTab) -->
      <section class="bento-grid">
        <!-- Quadrant A: Tactical Plans & Interactive HITL Queue -->
        @if (subTab() === 'overview' || subTab() === 'hitl') {
          <article class="ai-content-card bento-card" [class.span-full]="subTab() === 'hitl'">
            <header class="card-header">
              <div>
                <h4>Cola de Planes Tácticos y Auditoría HITL</h4>
                <span class="card-sub">{{ filteredPlans().length }} de {{ plans().length }} registros</span>
              </div>
              <div class="ai-capsule compact">
                @for (st of planStatuses; track st.id) {
                  <button
                    type="button"
                    class="ai-pill-tab sm"
                    [class.active]="planFilter() === st.id"
                    (click)="planFilter.set(st.id)"
                  >
                    {{ st.label }}
                  </button>
                }
              </div>
            </header>

            <div class="table-wrap">
              @if (filteredPlans().length === 0) {
                <p class="empty-msg">Sin planes tácticos para el filtro actual (Zero-Seed limpio).</p>
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
                    @for (p of filteredPlans().slice(0, subTab() === 'hitl' ? 25 : 8); track p.id) {
                      <tr>
                        <td class="cell-title" [title]="p.route">{{ p.title }}</td>
                        <td class="ai-tabular positive">+{{ p.expectedNetSpreadPct.toFixed(2) }}%</td>
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
        }

        <!-- Quadrant B: Real-time Watcher & Swarm Health -->
        @if (subTab() === 'overview' || subTab() === 'swarm') {
          <article class="ai-content-card bento-card">
            <header class="card-header">
              <div>
                <h4>Salud de Agentes y Watchers en Tiempo Real</h4>
                <span class="card-sub">Telemetría directa desde Electron Main</span>
              </div>
              <span class="tag" [class.tag-live]="watcherStatus().enabled">
                {{ watcherStatus().enabled ? 'WATCHER ON' : 'WATCHER PAUSADO' }}
              </span>
            </header>
            <div class="health-list">
              <div class="health-row">
                <div>
                  <strong>Alpha Watcher (30s Binance Book)</strong>
                  <div class="health-sub">Escaneos: {{ watcherStatus().scanCount }} · Min Spread: {{ watcherStatus().minNetSpreadPct }}%</div>
                </div>
                <button type="button" class="btn-mini" (click)="toggleWatcher.emit()">
                  {{ watcherStatus().enabled ? 'Pausar' : 'Activar' }}
                </button>
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
        }

        <!-- Quadrant C: Engram Memory Quarantine -->
        @if (subTab() === 'overview' || subTab() === 'swarm') {
          <article class="ai-content-card bento-card">
            <header class="card-header">
              <div>
                <h4>Gobernanza de Memoria (Cuarentena Engram)</h4>
                <span class="card-sub">Reglas verificadas vs pendientes de revisión humana</span>
              </div>
              <span class="pill-count warn">{{ quarantinedObs().length }} en cuarentena</span>
            </header>
            <div class="quarantine-split">
              @if (filteredQuarantined().length === 0) {
                <p class="empty-msg">Sin observaciones en cuarentena.</p>
              } @else {
                @for (obs of filteredQuarantined().slice(0, 6); track obs.id ?? obs.topicKey) {
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
              @for (act of activeObs().slice(0, 4); track act.id ?? act.topicKey) {
                <div class="active-rule">✓ {{ act.what }}</div>
              }
            </div>
          </article>
        }

        <!-- Quadrant D: Model Routing & Vault Security -->
        @if (subTab() === 'overview' || subTab() === 'vault') {
          <article class="ai-content-card bento-card" [class.span-full]="subTab() === 'vault'">
            <header class="card-header">
              <div>
                <h4>Enrutamiento de Modelos y Bóveda DPAPI</h4>
                <span class="card-sub">Failover determinista y desglose real por modelo</span>
              </div>
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
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        --ai-bg-0: var(--bg-0);
        --ai-panel: var(--panel);
        --ai-panel-2: var(--panel-2);
        --ai-line: var(--line);
        --ai-line-strong: var(--line-strong);
        --ai-text: var(--text);
        --ai-muted: var(--muted);
        --ai-accent: var(--accent);
        --ai-accent-2: var(--accent-2);
        --ai-gold: var(--gold);
        --ai-warn: var(--warn);
        --ai-danger: var(--danger);
        --ai-violet: color-mix(in srgb, var(--accent-2) 52%, var(--danger) 48%);
        --ai-radius: var(--radius);
        --ai-radius-lg: var(--radius-lg);
        --ai-blur: var(--blur-panel);
        --ai-shadow: var(--shadow);
        --ai-pill-active-bg: var(--text);
        --ai-pill-active-fg: var(--bg-0);
        display: block;
        color: var(--ai-text);
      }
      .gov-dashboard {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 14px 16px 28px;
        overflow-y: auto;
        flex: 1;
      }
      .ai-liquid-glass {
        background: color-mix(in srgb, var(--ai-panel) 78%, transparent);
        border: 1px solid var(--ai-line-strong);
        backdrop-filter: blur(var(--ai-blur)) saturate(1.45);
        -webkit-backdrop-filter: blur(var(--ai-blur)) saturate(1.45);
        box-shadow: var(--ai-shadow), inset 0 1px 0 color-mix(in srgb, var(--ai-text) 10%, transparent);
      }
      .gov-command-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 14px;
        border-radius: var(--ai-radius-lg);
      }
      .cmd-left, .cmd-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ai-capsule {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 4px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--ai-panel-2) 84%, transparent);
        border: 1px solid var(--ai-line);
      }
      .ai-capsule.compact { padding: 3px; }
      .ai-pill-tab {
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        border: none;
        background: transparent;
        color: var(--ai-muted);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .ai-pill-tab.sm { min-height: 26px; padding: 0 9px; font-size: 11px; }
      .ai-pill-tab.active {
        background: var(--ai-pill-active-bg);
        color: var(--ai-pill-active-fg);
      }
      .search-pill {
        background: var(--ai-panel-2);
        color: var(--ai-text);
        border: 1px solid var(--ai-line-strong);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px;
        min-width: 190px;
      }
      .btn-glass {
        background: var(--ai-panel-2);
        color: var(--ai-text);
        border: 1px solid var(--ai-line-strong);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .hero-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      @media (max-width: 1040px) {
        .hero-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      .ai-kpi-aura {
        position: relative;
        overflow: hidden;
        background: var(--ai-panel);
        border: 1px solid var(--ai-line);
        border-radius: var(--ai-radius-lg);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ai-kpi-aura::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 88% 12%, var(--ai-kpi-glow, transparent), transparent 60%);
      }
      .tone-gold { --ai-kpi-glow: color-mix(in srgb, var(--ai-gold) 24%, transparent); border-color: color-mix(in srgb, var(--ai-gold) 30%, var(--ai-line)); }
      .tone-emerald { --ai-kpi-glow: color-mix(in srgb, var(--ai-accent) 24%, transparent); border-color: color-mix(in srgb, var(--ai-accent) 30%, var(--ai-line)); }
      .tone-violet { --ai-kpi-glow: color-mix(in srgb, var(--ai-violet) 24%, transparent); border-color: color-mix(in srgb, var(--ai-violet) 30%, var(--ai-line)); }
      .tone-danger { --ai-kpi-glow: color-mix(in srgb, var(--ai-danger) 24%, transparent); border-color: color-mix(in srgb, var(--ai-danger) 34%, var(--ai-line)); }
      .kpi-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; position: relative; }
      .kpi-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ai-muted); }
      .kpi-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--ai-panel-2); border: 1px solid var(--ai-line); color: var(--ai-muted); }
      .kpi-body { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; position: relative; }
      .kpi-primary { font-size: 21px; font-weight: 800; display: block; color: var(--ai-text); }
      .kpi-secondary { font-size: 11px; color: var(--ai-muted); display: block; margin-top: 2px; }
      .kpi-spark { width: 96px; height: 30px; flex-shrink: 0; }
      .ai-tabular { font-variant-numeric: tabular-nums; }
      .positive { color: var(--ai-accent); }
      .status-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
      .status-pill.ok { background: color-mix(in srgb, var(--ai-accent) 16%, transparent); color: var(--ai-accent); }
      .status-pill.danger { background: color-mix(in srgb, var(--ai-danger) 18%, transparent); color: var(--ai-danger); }
      .bento-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      @media (max-width: 960px) {
        .bento-grid { grid-template-columns: 1fr; }
      }
      .ai-content-card {
        background: var(--ai-panel);
        border: 1px solid var(--ai-line);
        border-radius: var(--ai-radius-lg);
        padding: 15px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .bento-card.span-full { grid-column: 1 / -1; }
      .card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
      .card-header h4 { margin: 0; font-size: 13px; font-weight: 700; color: var(--ai-text); }
      .card-sub { font-size: 11px; color: var(--ai-muted); }
      .pill-count { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: var(--ai-panel-2); color: var(--ai-text); }
      .pill-count.warn { background: color-mix(in srgb, var(--ai-gold) 18%, transparent); color: var(--ai-gold); }
      .table-wrap { overflow-x: auto; }
      .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .audit-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; color: var(--ai-muted); padding: 6px; border-bottom: 1px solid var(--ai-line); }
      .audit-table td { padding: 7px 6px; border-bottom: 1px solid color-mix(in srgb, var(--ai-line) 70%, transparent); }
      .cell-title { max-width: 210px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .tag { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: var(--ai-panel-2); color: var(--ai-muted); }
      .tag-live { background: color-mix(in srgb, var(--ai-accent) 16%, transparent); color: var(--ai-accent); }
      .actions-cell { display: flex; gap: 4px; }
      .btn-mini { background: var(--ai-panel-2); color: var(--ai-text); border: 1px solid var(--ai-line-strong); border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 600; cursor: pointer; }
      .btn-mini.approve { background: color-mix(in srgb, var(--ai-accent) 18%, transparent); color: var(--ai-accent); border-color: color-mix(in srgb, var(--ai-accent) 40%, transparent); }
      .btn-mini.reject { background: color-mix(in srgb, var(--ai-danger) 16%, transparent); color: var(--ai-danger); border-color: color-mix(in srgb, var(--ai-danger) 38%, transparent); }
      .health-list, .quarantine-split, .routing-stack { display: flex; flex-direction: column; gap: 7px; }
      .health-row, .quarantine-item, .route-step, .kv-usage {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding: 9px 11px;
        border-radius: 12px;
        background: var(--ai-panel-2);
        border: 1px solid var(--ai-line);
        font-size: 12px;
      }
      .route-step.primary { border-color: color-mix(in srgb, var(--ai-gold) 38%, var(--ai-line)); }
      .health-sub, .sub-head { font-size: 11px; color: var(--ai-muted); }
      .q-text { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; }
      .q-text span { color: var(--ai-muted); }
      .q-actions { display: flex; gap: 5px; flex-shrink: 0; }
      .active-rule { font-size: 11.5px; color: var(--ai-accent); }
      .empty-msg { margin: 6px 0; font-size: 12px; color: var(--ai-muted); }
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

  readonly subTab = signal<GovSubTab>('overview');
  readonly planFilter = signal<PlanStatusFilter>('ALL');
  readonly searchQuery = signal<string>('');

  readonly planStatuses: { id: PlanStatusFilter; label: string }[] = [
    { id: 'ALL', label: 'Todos' },
    { id: 'PROPOSED', label: 'HITL' },
    { id: 'EXECUTED', label: 'OK' },
    { id: 'REJECTED', label: 'Vetados' },
  ];

  readonly proposedCount = computed(
    () => this.plans().filter((p) => p.status === 'PROPOSED').length,
  );

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

  readonly cacheHitRatePct = computed(() => {
    const total = this.usageSummary()?.totalCalls ?? 0;
    const cached = this.usageSummary()?.cachedCalls ?? 0;
    if (total <= 0) return 0;
    return Math.round((cached / total) * 100);
  });

  readonly approvalHealthPct = computed(() => {
    if (this.killSwitchActive()) return 0;
    const total = this.plans().length;
    if (total === 0) return 100;
    return Math.round(((total - this.rejectedCount()) / total) * 100);
  });

  readonly healthRingDashOffset = computed(() => {
    const pct = this.approvalHealthPct();
    return Math.round(113 - (113 * pct) / 100);
  });

  readonly filteredPlans = computed(() => {
    const filter = this.planFilter();
    const q = this.searchQuery().trim().toLowerCase();
    return this.plans().filter((p) => {
      if (filter === 'EXECUTED' && p.status !== 'EXECUTED' && p.status !== 'APPROVED') return false;
      if (filter !== 'ALL' && filter !== 'EXECUTED' && p.status !== filter) return false;
      if (q && !p.title.toLowerCase().includes(q) && !(p.route ?? '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  });

  readonly quarantinedObs = computed(() =>
    this.engramObservations().filter((o) => o.status === 'needs_review'),
  );

  readonly filteredQuarantined = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.quarantinedObs();
    return this.quarantinedObs().filter(
      (o) => o.what.toLowerCase().includes(q) || o.learned.toLowerCase().includes(q),
    );
  });

  readonly activeObs = computed(() =>
    this.engramObservations().filter((o) => o.status === 'active'),
  );
}
