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
      .ledger-wrap { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg, 18px); padding: 1rem; display: flex; flex-direction: column; gap: 0.85rem; color: var(--text); }
      .ledger-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.65rem; }
      .filters, .actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
      .sel { background: var(--panel-2); border: 1px solid var(--line-strong); color: var(--text); border-radius: 999px; padding: 0.42rem 0.8rem; font-size: 0.78rem; }
      .btn-tool { background: var(--panel-2); color: var(--text); border: 1px solid var(--line-strong); border-radius: 999px; padding: 0.42rem 0.85rem; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
      .btn-tool.primary { background: var(--text); border-color: var(--text); color: var(--bg-0); font-weight: 800; }
      .btn-tool:disabled { opacity: 0.5; cursor: not-allowed; }
      .table-scroll { overflow-x: auto; }
      .ledger-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text); font-variant-numeric: tabular-nums; }
      .ledger-table th { text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--line); }
      .run-row td { padding: 0.55rem 0.6rem; border-bottom: 1px solid color-mix(in srgb, var(--line) 75%, transparent); cursor: pointer; }
      .run-row:hover { background: var(--panel-2); }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.74rem; }
      .pill-trigger { font-size: 0.68rem; padding: 0.14rem 0.5rem; border-radius: 999px; background: var(--panel-2); color: var(--muted); }
      .pill-status { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; padding: 0.14rem 0.5rem; border-radius: 999px; background: var(--panel-2); color: var(--muted); }
      .pill-status[data-status='success'] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
      .pill-status[data-status='error'] { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
      .pill-status[data-status='blocked_killswitch'], .pill-status[data-status='blocked_budget'] { background: color-mix(in srgb, var(--gold) 20%, transparent); color: var(--gold); }
      .detail-row td { background: var(--panel-2); padding: 0.8rem; border-bottom: 1px solid var(--line); }
      .detail-box { display: flex; flex-direction: column; gap: 0.55rem; }
      .detail-label { font-size: 0.7rem; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 0.15rem; }
      .detail-text { margin: 0; font-size: 0.79rem; color: var(--text); }
      .tools-inline { display: flex; flex-wrap: wrap; gap: 0.35rem; }
      .tool-badge { font-size: 0.7rem; padding: 0.14rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--gold) 16%, transparent); color: var(--gold); }
      .tool-badge.fail { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
      .detail-err { font-size: 0.78rem; color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); padding: 0.45rem 0.6rem; border-radius: 10px; }
      .detail-pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.76rem; color: var(--text); max-height: 220px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .empty-cell { text-align: center; padding: 2rem; color: var(--muted); }
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
