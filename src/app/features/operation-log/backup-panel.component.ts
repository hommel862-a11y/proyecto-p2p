import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { AutoBackupService } from '../../core/auto-backup.service';

@Component({
  selector: 'app-backup-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backup-section">
      <span class="section-eyebrow">Gestión y Respaldo</span>
      <div class="backup-actions">
        <button type="button" class="btn btn-secondary" (click)="downloadJson.emit()">
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
          Exportar respaldo JSON
        </button>
        <button type="button" class="btn btn-secondary" (click)="fileInput.click()">
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
          Importar respaldo JSON
        </button>
        <input
          #fileInput
          type="file"
          accept="application/json,.json"
          hidden
          (change)="importFile.emit($event)"
        />
        <button type="button" class="btn btn-secondary" (click)="downloadCsv.emit()">
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
          class="btn btn-secondary"
          (click)="syncGoogleSheets.emit()"
          title="Sincroniza operaciones con Google Sheets vía MCP"
        >
          ☁️ Google Sheets
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="backupGoogleDrive.emit()"
          title="Respalda snapshot contable en Google Drive vía MCP"
        >
          💾 Google Drive
        </button>
      </div>

      <!-- Rolling 7-day auto-snapshots -->
      <div style="margin-top: 14px; border-top: 1px solid var(--border); padding-top: 10px;">
        <div
          style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;"
        >
          <span
            style="font-size: 0.76rem; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;"
          >
            Snapshots Automáticos (Últimos 7 días)
          </span>
          <button
            type="button"
            class="btn btn-secondary"
            (click)="autoBackup.createSnapshot()"
            style="font-size: 0.75rem; padding: 4px 10px;"
          >
            📸 Snapshot Manual Ahora
          </button>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          @for (s of autoBackup.snapshots(); track s.date) {
            <div
              style="background: var(--panel-2); border: 1px solid var(--line-strong); border-radius: 6px; padding: 6px 10px; font-size: 0.75rem; display: flex; align-items: center; gap: 8px;"
            >
              <span class="font-mono" style="font-weight: 600; color: var(--gold);">{{
                s.date
              }}</span>
              @if (s.checksumSha256) {
                <span
                  title="Integridad SHA-256 Verificada: {{ s.checksumSha256 }}"
                  style="color: #10b981; font-size: 0.8rem; cursor: help;"
                  >🛡️</span
                >
              }
              <span class="text-muted">({{ s.operationsCount }} ops)</span>
              <button
                type="button"
                class="btn btn-secondary"
                (click)="autoBackup.restoreSnapshot(s.date)"
                title="Restaurar este snapshot"
                style="font-size: 0.7rem; padding: 2px 6px; color: var(--accent);"
              >
                ↺ Restaurar
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                (click)="autoBackup.downloadSnapshot(s.date)"
                title="Descargar JSON"
                style="font-size: 0.7rem; padding: 2px 6px;"
              >
                ⬇
              </button>
            </div>
          } @empty {
            <span class="text-muted" style="font-size: 0.75rem;"
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
  readonly importFile = output<Event>();
  readonly downloadCsv = output<void>();
  readonly syncGoogleSheets = output<void>();
  readonly backupGoogleDrive = output<void>();
}
