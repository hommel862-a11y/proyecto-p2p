import { ChangeDetectionStrategy, Component, output } from '@angular/core';

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
      </div>
    </div>
  `,
})
export class BackupPanelComponent {
  readonly downloadJson = output<void>();
  readonly importFile = output<Event>();
  readonly downloadCsv = output<void>();
}
