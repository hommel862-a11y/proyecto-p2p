import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { AutoBackupService } from '../../core/auto-backup.service';

@Component({
  selector: 'app-backup-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="apple-dock-card" style="padding: 20px 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;">
        <span class="section-eyebrow" style="margin: 0; font-size: 0.8rem; letter-spacing: 0.04em;">
          GESTIÓN, AUTOMATIZACIÓN CONTABLE Y RESPALDO
        </span>
        <span class="apple-pill-mini gold font-mono">SHA-256 INTEGRITY</span>
      </div>

      <div class="backup-actions" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
        <button
          type="button"
          class="apple-pill-btn apple-btn-accent"
          (click)="binanceCsvInput.click()"
          title="Importa directamente el historial CSV de órdenes completadas de Binance P2P con deduplicación automática"
        >
          📥 Importar CSV Binance P2P
        </button>
        <input
          #binanceCsvInput
          type="file"
          accept=".csv,text/csv"
          hidden
          (change)="importBinanceCsv.emit($event)"
        />

        <button
          type="button"
          class="apple-pill-btn apple-btn-info"
          (click)="openRpaReconciler.emit()"
          title="Conciliación automática en lote de extractos y notificaciones bancarias contra el libro mayor"
        >
          🤖 Conciliador RPA Bancario (Lote)
        </button>

        <button
          type="button"
          class="apple-pill-btn apple-btn-gold"
          (click)="openInvoiceModal.emit()"
          title="Generar facturas PDF en lote para cumplimiento y blindaje bancario"
        >
          🛡️ Facturación Fiscal (PDF Lote)
        </button>

        <button type="button" class="apple-pill-btn apple-btn-secondary" (click)="downloadCsv.emit()">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Exportar CSV (Excel)
        </button>

        <button
          type="button"
          class="apple-pill-btn apple-btn-secondary"
          (click)="downloadExtendedCsv.emit()"
          title="Exporta CSV con Cuenta Bancaria, Titular/Cédula, Contraparte CRM y Duración para contabilidad"
        >
          📊 CSV Contable Completo
        </button>

        <button type="button" class="apple-pill-btn apple-btn-secondary" (click)="downloadJson.emit()">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar JSON
        </button>
        <button type="button" class="apple-pill-btn apple-btn-secondary" (click)="fileInput.click()">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Importar JSON
        </button>
        <input
          #fileInput
          type="file"
          accept="application/json,.json"
          hidden
          (change)="importFile.emit($event)"
        />

        <button
          type="button"
          class="apple-pill-btn apple-btn-secondary"
          (click)="syncGoogleSheets.emit()"
          title="Sincroniza operaciones y métricas FIFO con Google Sheets vía MCP"
        >
          ☁️ Google Sheets
        </button>
        <button
          type="button"
          class="apple-pill-btn apple-btn-secondary"
          (click)="backupGoogleDrive.emit()"
          title="Respalda snapshot contable en Google Drive vía MCP"
        >
          💾 Google Drive
        </button>
      </div>

      <!-- Rolling 7-day auto-snapshots -->
      <div style="margin-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px;">
        <div
          style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;"
        >
          <span
            style="font-size: 0.74rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;"
          >
            Snapshots Automáticos Criptográficos (Últimos 7 días — Incluye Cuentas y CRM)
          </span>
          <button
            type="button"
            class="apple-pill-btn apple-btn-gold"
            (click)="autoBackup.createSnapshot()"
            style="font-size: 0.74rem; padding: 5px 12px;"
          >
            📸 Snapshot Manual Ahora
          </button>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          @for (s of autoBackup.snapshots(); track s.date) {
            <div
              class="apple-lot-card lot-open"
              style="padding: 6px 12px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 8px;"
            >
              <span class="font-mono" style="font-weight: 700; color: var(--gold-strong);">{{
                s.date
              }}</span>
              @if (s.checksumSha256) {
                <span
                  title="Integridad SHA-256 Verificada: {{ s.checksumSha256 }}"
                  style="color: #2fd08f; font-size: 0.8rem; cursor: help;"
                  >🛡️</span
                >
              }
              <span class="text-muted font-mono">({{ s.operationsCount }} ops)</span>
              <button
                type="button"
                class="quick-fill-chip accent"
                (click)="autoBackup.restoreSnapshot(s.date)"
                title="Restaurar este snapshot"
              >
                ↺ Restaurar
              </button>
              <button
                type="button"
                class="quick-fill-chip"
                (click)="autoBackup.downloadSnapshot(s.date)"
                title="Descargar JSON"
              >
                ⬇
              </button>
            </div>
          } @empty {
            <span class="text-muted" style="font-size: 0.78rem;"
              >Aún no hay snapshots automáticos registrados.</span
            >
          }
        </div>
      </div>
    </div>
  `,
})
export class BackupPanelComponent {
  readonly autoBackup = inject(AutoBackupService);
  readonly downloadJson = output<void>();
  readonly openInvoiceModal = output<void>();
  readonly openRpaReconciler = output<void>();
  readonly importFile = output<Event>();
  readonly importBinanceCsv = output<Event>();
  readonly downloadCsv = output<void>();
  readonly downloadExtendedCsv = output<void>();
  readonly syncGoogleSheets = output<void>();
  readonly backupGoogleDrive = output<void>();
}
