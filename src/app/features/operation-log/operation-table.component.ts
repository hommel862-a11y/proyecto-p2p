import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_PIPES } from '../../core/format';
import { CounterpartyService } from '../../core/counterparty.service';
import { AccountsService } from '../../core/accounts.service';
import type { Operation, Counterparty, TradeMatchRecord } from '@p2p/core';

@Component({
  selector: 'app-operation-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FORMAT_PIPES],
  template: `
    <div class="data-section">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
        <span class="section-eyebrow" style="margin: 0;">
          Historial de Operaciones ({{ visibleOps().length }} de {{ operations().length }})
        </span>
      </div>

      <div class="table-toolbar" style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        @if (operations().length) {
          <div class="filter-group" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
            <label class="inline" style="margin: 0;">
              <span>Filtrar por par:</span>
              <select
                [value]="pairFilter()"
                (change)="pairFilterChange.emit($any($event.target).value)"
              >
                <option value="all">Todos los pares</option>
                <option value="USDT">Solo USDT/VES</option>
                <option value="EUR">Solo EUR/VES</option>
              </select>
            </label>

            <!-- Filtros rápidos por tipo (Pills sin alterar conteo de <select>) -->
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.74rem; padding: 4px 8px; border: 1px solid var(--border);"
                [style.borderColor]="typeFilter() === 'all' ? 'var(--accent)' : 'var(--border)'"
                [style.color]="typeFilter() === 'all' ? 'var(--accent)' : 'var(--muted)'"
                (click)="typeFilterChange.emit('all')"
              >
                Todas
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.74rem; padding: 4px 8px; border: 1px solid var(--border);"
                [style.borderColor]="typeFilter() === 'buy' ? 'var(--accent)' : 'var(--border)'"
                [style.color]="typeFilter() === 'buy' ? 'var(--accent)' : 'var(--muted)'"
                (click)="typeFilterChange.emit('buy')"
              >
                🟢 Compras
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.74rem; padding: 4px 8px; border: 1px solid var(--border);"
                [style.borderColor]="typeFilter() === 'sell' ? '#f87171' : 'var(--border)'"
                [style.color]="typeFilter() === 'sell' ? '#f87171' : 'var(--muted)'"
                (click)="typeFilterChange.emit('sell')"
              >
                🔴 Ventas
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.74rem; padding: 4px 8px; border: 1px solid var(--border);"
                [style.borderColor]="typeFilter() === 'assign' ? 'var(--gold)' : 'var(--border)'"
                [style.color]="typeFilter() === 'assign' ? 'var(--gold)' : 'var(--muted)'"
                (click)="typeFilterChange.emit('assign')"
              >
                💰 Tesorería
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                style="font-size: 0.74rem; padding: 4px 8px; border: 1px solid var(--border);"
                [style.borderColor]="onlyTodayFilter() ? 'var(--gold)' : 'var(--border)'"
                [style.color]="onlyTodayFilter() ? 'var(--gold)' : 'var(--muted)'"
                (click)="onlyTodayToggle.emit()"
              >
                📅 Solo Hoy
              </button>
            </div>
          </div>

          <div style="flex: 1; min-width: 220px; max-width: 340px;">
            <input
              type="search"
              class="terminal-input"
              style="font-size: 0.8rem; padding: 5px 10px; width: 100%;"
              placeholder="🔍 Buscar ref, comercio, cédula o nota..."
              [value]="searchQuery()"
              (input)="searchQueryChange.emit($any($event.target).value)"
            />
          </div>
        }
      </div>

      <div class="table-container">
        <table class="corporate-table" aria-label="Registro de operaciones P2P">
          <thead>
            <tr>
              <th scope="col">Fecha / Hora</th>
              <th scope="col">Tipo</th>
              <th scope="col">Par</th>
              <th scope="col" class="text-right">Monto VES</th>
              <th scope="col" class="text-right">Monto Cripto</th>
              <th scope="col" class="text-right">Precio</th>
              <th scope="col" class="text-right">PnL FIFO</th>
              <th scope="col">Comercio / Titular</th>
              <th scope="col">Cuenta Bancaria</th>
              <th scope="col" class="text-center">Duración</th>
              <th scope="col" class="text-center">Sin errores</th>
              <th scope="col" class="text-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            @for (o of visibleOps(); track o.id) {
              <tr>
                <td class="font-mono text-muted">
                  {{ o.timestamp | slice: 0 : 19 | date: 'yyyy-MM-dd HH:mm' }}
                </td>
                <td>
                  <span
                    class="badge"
                    [class.badge-buy]="o.type === 'buy'"
                    [class.badge-sell]="o.type === 'sell'"
                    [class.badge-accent]="o.type === 'assign'"
                  >
                    {{ o.type === 'buy' ? 'Compra' : o.type === 'sell' ? 'Venta' : 'Tesorería' }}
                  </span>
                </td>
                <td>
                  <strong>{{ o.pair }}</strong>
                </td>
                <td class="text-right font-mono">{{ o.vesAmount | ves }}</td>
                <td class="text-right font-mono">{{ o.usdtAmount | usdt }}</td>
                <td class="text-right font-mono">{{ o.price | num }}</td>
                <td class="text-right font-mono">
                  @if (getRowPnlVes(o.id); as rowPnl) {
                    <span
                      [class.positive]="rowPnl.pnlVes > 0"
                      [class.negative]="rowPnl.pnlVes < 0"
                      style="font-size: 0.78rem; font-weight: 600;"
                    >
                      {{ rowPnl.pnlVes > 0 ? '+' : '' }}{{ rowPnl.pnlVes | ves }}
                    </span>
                  } @else {
                    <span class="text-muted" style="font-size: 0.75rem;">—</span>
                  }
                </td>
                <td>
                  <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div>
                      <span>{{ o.merchantNote || '—' }}</span>
                      @if (getCounterpartyReputation(o.counterpartyId); as rep) {
                        <span
                          class="badge"
                          [class.badge-accent]="rep === 'TRUSTED' || rep === 'VERIFIED'"
                          [class.badge-sell]="rep === 'BLOCKED'"
                          [class.badge-buy]="rep === 'SUSPICIOUS'"
                          style="font-size: 0.68rem; margin-left: 5px; padding: 2px 6px;"
                        >
                          {{ rep }}
                        </span>
                      }
                    </div>
                    @if (o.payerName) {
                      <span class="font-mono text-muted" style="font-size: 0.7rem;">
                        🪪 Titular: {{ o.payerName }}
                      </span>
                    }
                  </div>
                </td>
                <td>
                  <span class="badge badge-muted" style="font-size: 0.78rem;">{{
                    getAccountName(o.bankAccountId)
                  }}</span>
                </td>
                <td class="text-center">
                  <span class="font-mono text-muted" style="font-size: 0.85em;">{{
                    formatDuration(o.durationMs)
                  }}</span>
                </td>
                <td class="text-center">
                  <span
                    class="badge"
                    [class.badge-accent]="o.errorFree"
                    [class.badge-muted]="!o.errorFree"
                  >
                    {{ o.errorFree ? 'Sí' : 'No' }}
                  </span>
                </td>
                <td class="text-center">
                  <div style="display: inline-flex; gap: 4px; align-items: center;">
                    @if (o.type !== 'assign') {
                      <button
                        type="button"
                        class="btn btn-ghost"
                        style="padding: 3px 6px; font-size: 0.75rem;"
                        (click)="cloneRequest.emit(o)"
                        title="Clonar / Repetir esta operación en el formulario"
                      >
                        🔁
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost"
                        style="padding: 3px 6px; font-size: 0.75rem;"
                        (click)="editRequest.emit(o)"
                        title="Editar esta operación"
                      >
                        ✏️
                      </button>
                    }
                    <button
                      type="button"
                      class="btn-icon-danger"
                      (click)="removeRequest.emit(o.id)"
                      [title]="
                        'Eliminar registro de ' +
                        (o.type === 'buy' ? 'compra' : 'venta') +
                        ' por ' +
                        (o.vesAmount | ves)
                      "
                      [attr.aria-label]="
                        'Eliminar operación del ' +
                        (o.timestamp | slice: 0 : 10) +
                        ' por ' +
                        (o.vesAmount | ves)
                      "
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="12" class="empty-state">
                  <p>Aún no hay operaciones registradas.</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class OperationTableComponent {
  readonly crmService = inject(CounterpartyService);
  readonly accountsService = inject(AccountsService);

  readonly operations = input.required<readonly Operation[]>();
  readonly visibleOps = input.required<readonly Operation[]>();
  readonly pairFilter = input<'all' | 'USDT' | 'EUR'>('all');
  readonly typeFilter = input<'all' | 'buy' | 'sell' | 'assign'>('all');
  readonly searchQuery = input<string>('');
  readonly onlyTodayFilter = input<boolean>(false);
  readonly fifoMatches = input<readonly TradeMatchRecord[]>([]);

  readonly pairFilterChange = output<'all' | 'USDT' | 'EUR'>();
  readonly typeFilterChange = output<'all' | 'buy' | 'sell' | 'assign'>();
  readonly searchQueryChange = output<string>();
  readonly onlyTodayToggle = output<void>();
  readonly cloneRequest = output<Operation>();
  readonly editRequest = output<Operation>();
  readonly removeRequest = output<string>();

  private readonly rowPnlMap = computed(() => {
    const map = new Map<string, { pnlVes: number; pnlUsdt: number }>();
    for (const m of this.fifoMatches()) {
      const prev = map.get(m.closingOpId) ?? { pnlVes: 0, pnlUsdt: 0 };
      map.set(m.closingOpId, {
        pnlVes: Math.round((prev.pnlVes + m.grossPnlVes) * 100) / 100,
        pnlUsdt: Math.round((prev.pnlUsdt + m.grossPnlUsdt) * 100) / 100,
      });
    }
    return map;
  });

  getRowPnlVes(opId: string): { pnlVes: number; pnlUsdt: number } | undefined {
    return this.rowPnlMap().get(opId);
  }

  formatDuration(ms?: number): string {
    if (!ms || ms <= 0) return '—';
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  getCounterpartyReputation(id?: string): Counterparty['reputation'] | undefined {
    if (!id) return undefined;
    return this.crmService.getById(id)?.reputation;
  }

  getAccountName(id?: string): string {
    if (!id) return '—';
    return this.accountsService.getAccountById(id)?.bankName ?? '—';
  }
}
