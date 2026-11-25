import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AgentStudioService,
  getSkillRiskTier,
} from '../../../core/agent-studio.service';
import type {
  AgentDomainDto,
  CustomAgentDto,
  PerAgentMetricSummaryDto,
} from '../../../../../electron/shared/types';

@Component({
  selector: 'app-agent-fleet-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fleet-wrap">
      <!-- KPI Strip -->
      <section class="kpi-strip">
        <div class="kpi-card">
          <span class="kpi-label">Flota Activa</span>
          <div class="kpi-value">
            {{ studio.activeCount() }} <span class="kpi-sub">/ {{ studio.totalCount() }}</span>
          </div>
          <span class="kpi-meta">Fuente única SQLite (custom_agents)</span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Daemons en Vivo</span>
          <div class="kpi-value" [class.text-emerald]="!killswitchActive()" [class.text-rose]="killswitchActive()">
            {{ daemonStatus()?.activeDaemonCount ?? studio.daemonsCount() }}
          </div>
          <span class="kpi-meta">
            @if (killswitchActive()) {
              BLOQUEADO POR KILLSWITCH
            } @else if (daemonStatus()?.started) {
              Scheduler activo · {{ daemonStatus()?.runningNowCount ?? 0 }} en curso
            } @else {
              Modo web (Scheduler en Electron)
            }
          </span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Ejecuciones 24h</span>
          <div class="kpi-value">{{ metrics()?.runs24h ?? 0 }}</div>
          <span class="kpi-meta">
            Éxito {{ metrics()?.successRate24hPct ?? 100 }}% ·
            {{ metrics()?.errors24h ?? 0 }} err ·
            {{ metrics()?.blocked24h ?? 0 }} bloq
          </span>
        </div>

        <div class="kpi-card">
          <span class="kpi-label">Gasto IA 24h</span>
          <div class="kpi-value">\${{ (metrics()?.totalCost24hUsd ?? 0) | number: '1.4-4' }}</div>
          <span class="kpi-meta">Latencia media: {{ metrics()?.avgLatency24hMs ?? 0 }} ms</span>
        </div>
      </section>

      <!-- Live Daemon Scheduler Monitor -->
      @if ((daemonStatus()?.slots?.length ?? 0) > 0) {
        <section class="daemon-panel">
          <div class="section-head">
            <div>
              <h3>Monitor de Daemons en Background (READ-ONLY)</h3>
              <p>Ejecución periódica con bloqueo Killswitch, tope diario USD y veto automático de tools HITL.</p>
            </div>
            <button type="button" class="btn-ghost" (click)="studio.loadFleetTelemetry()">↻ Refrescar</button>
          </div>
          <div class="daemon-grid">
            @for (slot of daemonStatus()!.slots; track slot.agentId) {
              <div class="daemon-slot">
                <div class="slot-top">
                  <span class="slot-dot" [class.running]="slot.isRunningNow" [class.blocked]="killswitchActive()"></span>
                  <strong>{{ slot.agentName }}</strong>
                  <span class="pill-interval">c/{{ slot.intervalSec }}s</span>
                </div>
                <div class="slot-meta">
                  <span>Modelo: <code>{{ slot.modelName }}</code></span>
                  <span>
                    Presupuesto 24h:
                    <strong>\${{ slot.dailySpendUsd | number: '1.4-4' }}</strong> / \${{ slot.dailyBudgetUsd | number: '1.2-2' }}
                  </span>
                </div>
                <div class="budget-bar">
                  <div
                    class="budget-fill"
                    [style.width.%]="budgetPct(slot.dailySpendUsd, slot.dailyBudgetUsd)"
                    [class.warn]="budgetPct(slot.dailySpendUsd, slot.dailyBudgetUsd) >= 80"
                  ></div>
                </div>
                <div class="slot-actions">
                  <span class="status-tag" [attr.data-status]="slot.lastStatus ?? 'idle'">
                    {{ slot.lastStatus ? slot.lastStatus : 'en espera' }}
                  </span>
                  <button
                    type="button"
                    class="btn-xs"
                    [disabled]="runningAgentId() === slot.agentId"
                    (click)="triggerTickNow(slot.agentId)"
                  >
                    {{ runningAgentId() === slot.agentId ? 'Ejecutando...' : '▶ Ejecutar Tick' }}
                  </button>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- Filters -->
      <section class="filter-bar">
        <div class="chip-group">
          @for (d of domains; track d.id) {
            <button
              type="button"
              class="filter-chip"
              [class.active]="studio.filterDomain() === d.id"
              (click)="studio.setFilterDomain(d.id)"
            >
              {{ d.label }}
            </button>
          }
        </div>
        <div class="filter-right">
          <select
            class="select-compact"
            [ngModel]="studio.filterMode()"
            (ngModelChange)="studio.setFilterMode($event)"
            aria-label="Filtrar por modo de ejecución"
          >
            <option value="all">Todos los modos</option>
            <option value="ambient_daemon">Solo Daemons 24/7</option>
            <option value="on_demand">Solo Bajo Demanda</option>
          </select>
          <input
            type="search"
            class="search-input"
            placeholder="Buscar agente, modelo o skill..."
            [ngModel]="studio.searchQuery()"
            (ngModelChange)="studio.setSearchQuery($event)"
          />
        </div>
      </section>

      <!-- Fleet Grid -->
      <section class="fleet-grid">
        @for (agent of studio.filteredAgents(); track agent.id) {
          <article class="agent-card" [class.inactive]="!agent.isActive">
            <header class="card-head">
              <div>
                <div class="badges-row">
                  <span class="badge-domain" [attr.data-domain]="agent.domain ?? 'P2P_DESK'">
                    {{ agent.domain ?? 'P2P_DESK' }}
                  </span>
                  <span class="badge-mode" [class.daemon]="agent.executionMode === 'ambient_daemon'">
                    {{ agent.executionMode === 'ambient_daemon' ? 'DAEMON ' + (agent.scheduleIntervalSec ?? 300) + 's' : 'ON-DEMAND' }}
                  </span>
                  <span class="badge-ver">v{{ agent.promptVersion ?? 1 }}</span>
                </div>
                <h4>{{ agent.name }}</h4>
              </div>
              <label class="toggle-switch" title="Activar / pausar agente">
                <input
                  type="checkbox"
                  [checked]="agent.isActive"
                  (change)="studio.toggleAgent(agent.id)"
                />
                <span class="slider"></span>
              </label>
            </header>

            <p class="card-desc">{{ agent.description }}</p>

            <div class="card-specs">
              <span><strong>Modelo:</strong> <code>{{ agent.modelName }}</code></span>
              <span><strong>Cap diario:</strong> \${{ (agent.dailyBudgetUsd ?? 1.5) | number: '1.2-2' }}</span>
              <span>
                <strong>Skills:</strong> {{ agent.skills.length }}
                ({{ countHitlSkills(agent.skills) }} HITL)
              </span>
              @if (agentMetric(agent.id); as m) {
                <span><strong>24h:</strong> {{ m.runs24h }} runs · \${{ m.cost24hUsd | number: '1.4-4' }}</span>
              }
            </div>

            <div class="skills-preview">
              @for (s of agent.skills.slice(0, 4); track s) {
                <span class="skill-chip" [class.hitl]="isHitl(s)">{{ s }}</span>
              }
              @if (agent.skills.length > 4) {
                <span class="skill-chip more">+{{ agent.skills.length - 4 }}</span>
              }
            </div>

            <footer class="card-actions">
              <button type="button" class="btn-primary-sm" (click)="editAgent.emit(agent)">
                ⚡ Studio & Sandbox
              </button>
              <button type="button" class="btn-ghost-sm" (click)="openInCopilot.emit(agent)">
                💬 Copiloto
              </button>
              <button type="button" class="btn-danger-sm" (click)="requestDelete.emit(agent)" title="Eliminar agente">
                ✕
              </button>
            </footer>
          </article>
        } @empty {
          <div class="empty-state">
            No hay agentes que coincidan con el filtro actual.
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .fleet-wrap { display: flex; flex-direction: column; gap: 1rem; }
      .kpi-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; }
      .kpi-card { background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 12px; padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
      .kpi-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
      .kpi-value { font-size: 1.45rem; font-weight: 700; color: #f8fafc; font-variant-numeric: tabular-nums; }
      .kpi-sub { font-size: 0.9rem; color: #64748b; font-weight: 500; }
      .kpi-meta { font-size: 0.75rem; color: #94a3b8; }
      .text-emerald { color: #34d399; }
      .text-rose { color: #fb7185; }
      .daemon-panel { background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 12px; padding: 1rem; }
      .section-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.75rem; }
      .section-head h3 { margin: 0; font-size: 0.95rem; color: #e2e8f0; }
      .section-head p { margin: 0.15rem 0 0; font-size: 0.78rem; color: #94a3b8; }
      .daemon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem; }
      .daemon-slot { background: rgba(2, 6, 23, 0.65); border: 1px solid rgba(148, 163, 184, 0.15); border-radius: 10px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.45rem; }
      .slot-top { display: flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; color: #f1f5f9; }
      .slot-dot { width: 8px; height: 8px; border-radius: 999px; background: #10b981; flex-shrink: 0; }
      .slot-dot.running { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
      .slot-dot.blocked { background: #f43f5e; }
      .pill-interval { margin-left: auto; font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 999px; background: rgba(56, 189, 248, 0.15); color: #7dd3fc; }
      .slot-meta { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.74rem; color: #94a3b8; }
      .budget-bar { height: 5px; border-radius: 999px; background: rgba(148, 163, 184, 0.18); overflow: hidden; }
      .budget-fill { height: 100%; background: #10b981; transition: width 0.25s ease; }
      .budget-fill.warn { background: #f59e0b; }
      .slot-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 0.2rem; }
      .status-tag { font-size: 0.7rem; text-transform: uppercase; padding: 0.1rem 0.45rem; border-radius: 6px; background: rgba(148, 163, 184, 0.14); color: #cbd5e1; }
      .status-tag[data-status='success'] { background: rgba(16, 185, 129, 0.16); color: #34d399; }
      .status-tag[data-status='blocked_killswitch'], .status-tag[data-status='blocked_budget'] { background: rgba(245, 158, 11, 0.18); color: #fbbf24; }
      .status-tag[data-status='error'] { background: rgba(244, 63, 94, 0.18); color: #fb7185; }
      .filter-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }
      .chip-group { display: flex; flex-wrap: wrap; gap: 0.4rem; }
      .filter-chip { border: 1px solid rgba(148, 163, 184, 0.22); background: rgba(15, 23, 42, 0.6); color: #cbd5e1; border-radius: 999px; padding: 0.3rem 0.75rem; font-size: 0.76rem; cursor: pointer; }
      .filter-chip.active { background: rgba(14, 165, 233, 0.22); border-color: #38bdf8; color: #f8fafc; font-weight: 600; }
      .filter-right { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
      .select-compact, .search-input { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(148, 163, 184, 0.22); color: #f1f5f9; border-radius: 8px; padding: 0.4rem 0.65rem; font-size: 0.8rem; }
      .search-input { min-width: 220px; }
      .fleet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 0.85rem; }
      .agent-card { background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
      .agent-card.inactive { opacity: 0.62; }
      .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
      .card-head h4 { margin: 0.3rem 0 0; font-size: 0.96rem; color: #f8fafc; }
      .badges-row { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
      .badge-domain { font-size: 0.66rem; font-weight: 700; padding: 0.12rem 0.45rem; border-radius: 6px; background: rgba(56, 189, 248, 0.16); color: #7dd3fc; }
      .badge-domain[data-domain='FINANCE_360'] { background: rgba(16, 185, 129, 0.16); color: #6ee7b7; }
      .badge-domain[data-domain='SECURITY'] { background: rgba(244, 63, 94, 0.16); color: #fda4af; }
      .badge-domain[data-domain='ARM_B2B'] { background: rgba(168, 85, 247, 0.18); color: #d8b4fe; }
      .badge-mode { font-size: 0.66rem; padding: 0.12rem 0.45rem; border-radius: 6px; background: rgba(148, 163, 184, 0.14); color: #cbd5e1; }
      .badge-mode.daemon { background: rgba(16, 185, 129, 0.16); color: #34d399; }
      .badge-ver { font-size: 0.66rem; color: #94a3b8; }
      .card-desc { margin: 0; font-size: 0.79rem; color: #94a3b8; line-height: 1.4; }
      .card-specs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 0.5rem; font-size: 0.75rem; color: #cbd5e1; }
      .skills-preview { display: flex; flex-wrap: wrap; gap: 0.3rem; }
      .skill-chip { font-size: 0.68rem; padding: 0.14rem 0.45rem; border-radius: 6px; background: rgba(16, 185, 129, 0.12); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.24); }
      .skill-chip.hitl { background: rgba(245, 158, 11, 0.14); color: #fcd34d; border-color: rgba(245, 158, 11, 0.32); }
      .skill-chip.more { background: rgba(148, 163, 184, 0.12); color: #94a3b8; border-color: transparent; }
      .card-actions { display: flex; gap: 0.45rem; margin-top: auto; padding-top: 0.4rem; border-top: 1px solid rgba(148, 163, 184, 0.12); }
      .btn-primary-sm { flex: 1; background: #0284c7; color: #fff; border: none; border-radius: 8px; padding: 0.42rem 0.65rem; font-size: 0.77rem; font-weight: 600; cursor: pointer; }
      .btn-ghost-sm, .btn-ghost, .btn-xs { background: rgba(148, 163, 184, 0.12); color: #e2e8f0; border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 8px; padding: 0.38rem 0.65rem; font-size: 0.75rem; cursor: pointer; }
      .btn-danger-sm { background: rgba(244, 63, 94, 0.14); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.28); border-radius: 8px; padding: 0.38rem 0.55rem; font-size: 0.75rem; cursor: pointer; }
      .toggle-switch { position: relative; display: inline-block; width: 38px; height: 22px; flex-shrink: 0; }
      .toggle-switch input { opacity: 0; width: 0; height: 0; }
      .slider { position: absolute; inset: 0; background: #334155; border-radius: 999px; transition: 0.2s; cursor: pointer; }
      .slider:before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #f8fafc; border-radius: 50%; transition: 0.2s; }
      .toggle-switch input:checked + .slider { background: #10b981; }
      .toggle-switch input:checked + .slider:before { transform: translateX(16px); }
      .empty-state { grid-column: 1 / -1; text-align: center; padding: 2rem; color: #94a3b8; border: 1px dashed rgba(148, 163, 184, 0.25); border-radius: 12px; }
    `,
  ],
})
export class AgentFleetDashboardComponent {
  readonly studio = inject(AgentStudioService);
  @Output() readonly editAgent = new EventEmitter<CustomAgentDto>();
  @Output() readonly openInCopilot = new EventEmitter<CustomAgentDto>();
  @Output() readonly requestDelete = new EventEmitter<CustomAgentDto>();

  readonly runningAgentId = signal<string | null>(null);
  readonly metrics = computed(() => this.studio.fleetMetrics());
  readonly daemonStatus = computed(() => this.studio.daemonStatus());
  readonly killswitchActive = computed(() => Boolean(this.daemonStatus()?.killswitchActive));

  readonly domains: { id: 'all' | AgentDomainDto; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'P2P_DESK', label: 'Mesa P2P' },
    { id: 'FINANCE_360', label: 'Finanzas 360' },
    { id: 'SECURITY', label: 'Seguridad & Riesgo' },
    { id: 'ARM_B2B', label: 'ARM CRM' },
  ];

  isHitl(skillId: string): boolean {
    return getSkillRiskTier(skillId) === 'HITL';
  }

  countHitlSkills(skills: string[]): number {
    return skills.filter((s) => this.isHitl(s)).length;
  }

  agentMetric(agentId: string): PerAgentMetricSummaryDto | undefined {
    return this.metrics()?.perAgent.find((p) => p.agentId === agentId);
  }

  budgetPct(spent: number, cap: number): number {
    if (!cap || cap <= 0) return 0;
    return Math.min(100, Math.round((spent / cap) * 100));
  }

  async triggerTickNow(agentId: string): Promise<void> {
    this.runningAgentId.set(agentId);
    try {
      await this.studio.runNow(agentId);
    } finally {
      this.runningAgentId.set(null);
    }
  }
}
