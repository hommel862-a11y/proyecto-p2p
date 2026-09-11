import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FORMAT_PIPES } from '../../core/format';
import { CounterpartyService } from '../../core/counterparty.service';
import { AccountsService } from '../../core/accounts.service';
import type { Operation, Counterparty } from '@p2p/core';

@Component({
  selector: 'app-operation-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FORMAT_PIPES],
  template: `
    <div class="data-section">
      <span class="section-eyebrow">Historial de Operaciones</span>
      <div class="table-toolbar">
        @if (operations().length) {
          <div class="filter-group">
            <label class="inline">
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
              <th scope="col">Comercio</th>
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
                <td>
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
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="11" class="empty-state">
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

  readonly pairFilterChange = output<'all' | 'USDT' | 'EUR'>();
  readonly removeRequest = output<string>();

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
