import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import type { FxSettlementLedgerEntry } from '../../../core/telegram-worker.service';

@Component({
  selector: 'app-fx-settlement-ledger-card',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../styles/_fx-desk-glass-tokens.scss'],
  styles: [
    `
      .ledger-card {
        overflow: hidden;
      }
      .ledger-header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--fx-line);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
      }
      .ledger-title {
        font-size: 0.86rem;
        font-weight: 700;
      }
      .ledger-sub {
        font-size: 0.72rem;
        color: var(--fx-muted);
      }
      .ledger-scroll {
        width: 100%;
        overflow-x: auto;
      }
      .ledger-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.74rem;
      }
      .ledger-table th {
        text-align: left;
        padding: 8px 12px;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--fx-muted);
        background: var(--fx-panel-2);
        border-bottom: 1px solid var(--fx-line);
        white-space: nowrap;
      }
      .ledger-table td {
        padding: 9px 12px;
        border-bottom: 1px solid var(--fx-line);
        white-space: nowrap;
      }
      .empty-ledger {
        padding: 18px 16px;
        font-size: 0.76rem;
        color: var(--fx-muted);
        text-align: center;
      }
    `,
  ],
  template: `
    <section class="fx-content-card ledger-card" aria-label="Libro Mayor Inmutable de Pactos Cambiarios">
      <header class="ledger-header">
        <div>
          <div class="ledger-title">
            Libro Mayor Forense de Pactos Cambiarios (<code>fx_settlement_ledger</code> · SQLite WAL)
          </div>
          <div class="ledger-sub">
            Cadena SHA-256 append-only · Separación auditada entre USD comprados en banca y USDT netos en FIFO
          </div>
        </div>
        <span class="fx-status-chip is-fluid">
          ● {{ entries().length }} registros auditados
        </span>
      </header>

      @if (entries().length > 0) {
        <div class="ledger-scroll">
          <table class="ledger-table fx-tabular">
            <thead>
              <tr>
                <th>Fecha VET</th>
                <th>Banco / Cuenta</th>
                <th>Modalidad</th>
                <th>USD Comprados</th>
                <th>Tasa BCV</th>
                <th>Débito Exacto Bs</th>
                <th>IGTF + Riel</th>
                <th>USDT Netos FIFO</th>
                <th>Canal / Hash SHA-256</th>
              </tr>
            </thead>
            <tbody class="fx-mono">
              @for (row of entries().slice(0, 8); track row.id) {
                <tr>
                  <td>{{ row.vetDateKey }}</td>
                  <td>{{ row.bankId }} · {{ row.accountName || 'Simulado' }}</td>
                  <td>{{ row.modality }}</td>
                  <td><strong>\${{ row.purchasedUsd | number: '1.2-2' }} USD</strong></td>
                  <td>Bs. {{ row.bcvRateVes | number: '1.2-2' }}</td>
                  <td>Bs. {{ row.totalDebitVes | number: '1.2-2' }}</td>
                  <td style="color: var(--fx-danger)">
                    −\${{ row.igtfUsd + row.railFeeUsd | number: '1.2-2' }}
                  </td>
                  <td style="color: var(--fx-accent); font-weight: 700">
                    +{{ row.netUsdt | number: '1.2-2' }} USDT
                  </td>
                  <td>
                    {{ row.channel }}
                    @if (row.rowHash) {
                      · <span style="color: var(--fx-muted)">{{ row.rowHash.slice(0, 8) }}…</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="empty-ledger">
          Aún no registraste pactos cambiarios en esta sesión. Seleccioná un banco viable y pulsá
          <strong>Liquidar en SQLite</strong> o confirmá desde <code>/mesa</code> en Telegram.
        </div>
      }
    </section>
  `,
})
export class FxSettlementLedgerCardComponent {
  readonly entries = input.required<readonly FxSettlementLedgerEntry[]>();
}
