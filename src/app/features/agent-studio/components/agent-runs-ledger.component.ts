import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgentStudioService } from '../../../core/agent-studio.service';
import type { AgentRunDto, AgentRunStatusDto, AgentRunTriggerTypeDto } from '../../../../../electron/shared/types';

@Component({
  selector: 'app-agent-runs-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="ledger-wrap">
      <div class="ledger-toolbar">
        <div class="filters">
          <select
            class="sel"
            [ngModel]="filterAgentId()"
            (ngModelChange)="filterAgentId.set($event)"
            aria-label="Filtrar por agente"
          >
            <option value="">Todos los agentes</option>
            @for (a of studio.agents(); track a.id) {
              <option [value]="a.id">{{ a.name }}</option>
            }
          </select>

          <select
            class="sel"
            [ngModel]="filterStatus()"
            (ngModelChange)="filterStatus.set($event)"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="success">Éxito</option>
            <option value="error">Error</option>
            <option value="blocked_killswitch">Bloqueado Killswitch</option>
            <option value="blocked_budget">Bloqueado Presupuesto</option>
          </select>

          <select
            class="sel"
            [ngModel]="filterTrigger()"
            (ngModelChange)="filterTrigger.set($event)"
            aria-label="Filtrar por disparador"
          >
            <option value="">Todos los orígenes</option>
            <option value="daemon_tick">Daemon Tick</option>
            <option value="sandbox_test">Sandbox Dry-Run</option>
            <option value="manual_run">Manual Run</option>
            <option value="copilot_mention">Copiloto</option>
          </select>
        </div>

        <div class="actions">
          <button type="button" class="btn-tool" (click)="studio.loadFleetTelemetry()">↻ Refrescar</button>
          <button type="button" class="btn-tool primary" [disabled]="filteredRuns().length === 0" (click)="downloadCsv()">
            ⬇ Exportar CSV ({{ filteredRuns().length }})
          </button>
        </div>
      </div>

      <div class="table-scroll">
        <table class="ledger-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Agente</th>
              <th>Origen</th>
              <th>Estado</th>
              <th>Modelo</th>
              <th>Tools</th>
              <th>Latencia</th>
              <th>Costo USD</th>
            </tr>
          </thead>
          <tbody>
            @for (run of filteredRuns(); track run.id) {
              <tr class="run-row" (click)="toggleExpand(run.id)" [class.expanded]="expandedId() === run.id">
                <td class="mono">{{ run.startedAt | date: 'dd/MM HH:mm:ss' }}</td>
                <td><strong>{{ run.agentName ?? run.agentId }}</strong></td>
                <td><span class="pill-trigger">{{ run.triggerType }}</span></td>
                <td><span class="pill-status" [attr.data-status]="run.status">{{ run.status }}</span></td>
                <td class="mono">{{ run.modelUsed }}</td>
                <td>{{ run.toolsCalled.length }}</td>
                <td class="mono">{{ run.latencyMs }} ms</td>
                <td class="mono">\${{ run.costUsd | number: '1.5-5' }}</td>
              </tr>
              @if (expandedId() === run.id) {
                <tr class="detail-row">
                  <td colspan="8">
                    <div class="detail-box">
                      <div>
                        <span class="detail-label">Prompt de Entrada:</span>
                        <p class="detail-text">{{ run.promptInput }}</p>
                      </div>
                      @if (run.toolsCalled.length > 0) {
                        <div>
                          <span class="detail-label">Tools Ejecutadas:</span>
                          <div class="tools-inline">
                            @for (t of run.toolsCalled; track t.name) {
                              <span class="tool-badge" [class.fail]="!t.ok">{{ t.name }} ({{ t.latencyMs ?? 0 }}ms)</span>
                            }
                          </div>
                        </div>
                      }
                      @if (run.errorMessage) {
                        <div class="detail-err"><strong>Error / Bloqueo:</strong> {{ run.errorMessage }}</div>
                      }
                      @if (run.responseOutput) {
                        <div>
                          <span class="detail-label">Salida del Agente:</span>
                          <pre class="detail-pre">{{ run.responseOutput }}</pre>
                        </div>
                      }
                    </div>
                  </td>
                </tr>
              }
            } @empty {
              <tr>
                <td colspan="8" class="empty-cell">
                  Sin ejecuciones registradas aún en SQLite <code>agent_runs</code>. Dispara un Sandbox Dry-Run o un Tick manual para auditar trazas reales.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [
    `
      .ledger-wrap { background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 12px; padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem; }
      .ledger-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.65rem; }
      .filters, .actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
      .sel { background: rgba(2, 6, 23, 0.75); border: 1px solid rgba(148, 163, 184, 0.24); color: #f1f5f9; border-radius: 8px; padding: 0.4rem 0.65rem; font-size: 0.78rem; }
      .btn-tool { background: rgba(148, 163, 184, 0.14); color: #e2e8f0; border: 1px solid rgba(148, 163, 184, 0.24); border-radius: 8px; padding: 0.4rem 0.75rem; font-size: 0.78rem; cursor: pointer; }
      .btn-tool.primary { background: #0284c7; border-color: #0284c7; color: #fff; font-weight: 600; }
      .btn-tool:disabled { opacity: 0.5; cursor: not-allowed; }
      .table-scroll { overflow-x: auto; }
      .ledger-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: #e2e8f0; }
      .ledger-table th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(148, 163, 184, 0.18); }
      .run-row td { padding: 0.55rem 0.6rem; border-bottom: 1px solid rgba(148, 163, 184, 0.1); cursor: pointer; }
      .run-row:hover { background: rgba(56, 189, 248, 0.06); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; }
      .pill-trigger { font-size: 0.68rem; padding: 0.12rem 0.45rem; border-radius: 6px; background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
      .pill-status { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 0.12rem 0.45rem; border-radius: 6px; background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
      .pill-status[data-status='success'] { background: rgba(16, 185, 129, 0.18); color: #34d399; }
      .pill-status[data-status='error'] { background: rgba(244, 63, 94, 0.18); color: #fb7185; }
      .pill-status[data-status='blocked_killswitch'], .pill-status[data-status='blocked_budget'] { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
      .detail-row td { background: rgba(2, 6, 23, 0.72); padding: 0.8rem; border-bottom: 1px solid rgba(148, 163, 184, 0.18); }
      .detail-box { display: flex; flex-direction: column; gap: 0.55rem; }
      .detail-label { font-size: 0.7rem; text-transform: uppercase; color: #94a3b8; display: block; margin-bottom: 0.15rem; }
      .detail-text { margin: 0; font-size: 0.79rem; color: #cbd5e1; }
      .tools-inline { display: flex; flex-wrap: wrap; gap: 0.35rem; }
      .tool-badge { font-size: 0.7rem; padding: 0.12rem 0.45rem; border-radius: 6px; background: rgba(56, 189, 248, 0.14); color: #7dd3fc; }
      .tool-badge.fail { background: rgba(244, 63, 94, 0.16); color: #fda4af; }
      .detail-err { font-size: 0.78rem; color: #fda4af; background: rgba(244, 63, 94, 0.12); padding: 0.45rem 0.6rem; border-radius: 8px; }
      .detail-pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.76rem; color: #e2e8f0; max-height: 220px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .empty-cell { text-align: center; padding: 2rem; color: #94a3b8; }
    `,
  ],
})
export class AgentRunsLedgerComponent {
  readonly studio = inject(AgentStudioService);

  readonly filterAgentId = signal<string>('');
  readonly filterStatus = signal<'' | AgentRunStatusDto>('');
  readonly filterTrigger = signal<'' | AgentRunTriggerTypeDto>('');
  readonly expandedId = signal<string | null>(null);

  readonly filteredRuns = computed<AgentRunDto[]>(() => {
    let list = this.studio.runs();
    const aid = this.filterAgentId();
    if (aid) list = list.filter((r) => r.agentId === aid);
    const st = this.filterStatus();
    if (st) list = list.filter((r) => r.status === st);
    const tr = this.filterTrigger();
    if (tr) list = list.filter((r) => r.triggerType === tr);
    return list;
  });

  toggleExpand(id: string): void {
    this.expandedId.update((curr) => (curr === id ? null : id));
  }

  downloadCsv(): void {
    const csv = this.studio.exportRunsCsv(this.filteredRuns());
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent_runs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
