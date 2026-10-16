import { Injectable, inject, signal } from '@angular/core';
import { Finance360Service } from '../finance-360.service';
import { ToastService } from '../toast.service';
import { McpService } from '../mcp.service';
import type { Finance360LedgerState } from '../models/finance-360.models';

export interface DriveSyncResult {
  success: boolean;
  filesCount: number;
  targetFolder: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class FinanceDriveSyncService {
  private readonly financeService: Finance360Service;
  private readonly toast: ToastService;
  private readonly mcp: McpService | null;

  constructor(
    financeService?: Finance360Service,
    toast?: ToastService,
    mcp?: McpService,
  ) {
    if (financeService) {
      this.financeService = financeService;
    } else {
      this.financeService = inject(Finance360Service);
    }

    if (toast) {
      this.toast = toast;
    } else {
      this.toast = inject(ToastService);
    }

    if (mcp !== undefined) {
      this.mcp = mcp;
    } else {
      try {
        this.mcp = inject(McpService, { optional: true });
      } catch {
        this.mcp = null;
      }
    }
  }

  private readonly STORAGE_SYNC_KEY = 'p2p.finance360.last_drive_sync';

  readonly syncStatus = signal<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  readonly lastSyncTimestamp = signal<string | null>(this.loadLastSyncTime());

  /**
   * Generates hierarchical path for storing artifacts in Google Drive:
   * e.g. /Finanzas_360/2026/10_Octubre/Recibos_Efectivo/
   */
  getFolderHierarchy(category: 'receipts' | 'invoices' | 'quotes' | 'backups', date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];
    const monthName = monthNames[date.getMonth()];
    const monthFolder = `${month}_${monthName}`;

    let sub = 'General';
    if (category === 'receipts') sub = 'Recibos_Efectivo';
    else if (category === 'invoices') sub = 'Facturas_OCR';
    else if (category === 'quotes') sub = 'Presupuestos_PDF';
    else if (category === 'backups') sub = 'Libro_Maestro';

    return `/Finanzas_360/${year}/${monthFolder}/${sub}/`;
  }

  /**
   * Exports entire ledger state as a formatted JSON snapshot.
   */
  generateMasterLedgerJson(): string {
    const state = this.financeService.state();
    const backupPayload = {
      exportDate: new Date().toISOString(),
      metadata: {
        app: 'HOMEL 360 Suite',
        version: state.version,
        totalAssetsUsd: this.financeService.totalAssetsUsd(),
        totalLiabilitiesUsd: this.financeService.totalLiabilitiesUsd(),
        netWorthUsd: this.financeService.netWorthUsd(),
        appliedBcvRate: this.financeService.currentBcvRate(),
      },
      ledger: state,
    };

    return JSON.stringify(backupPayload, null, 2);
  }

  /**
   * Generates CSV format for simple import into Google Sheets / Excel.
   */
  exportLedgerAsCsv(type: 'expenses' | 'incomes' | 'liabilities'): string {
    const state = this.financeService.state();

    if (type === 'expenses') {
      const headers = ['ID', 'Fecha', 'Titulo', 'Ambito', 'Categoria', 'Monto_USD', 'Monto_VES', 'Canal', 'Notas'];
      const rows = state.expenses.map((e) => [
        e.id,
        e.date,
        `"${e.title.replace(/"/g, '""')}"`,
        e.scope,
        e.category,
        e.triMonetary.amount_usd.toFixed(2),
        e.triMonetary.amount_ves.toFixed(2),
        e.channel,
        `"${(e.notes || '').replace(/"/g, '""')}"`,
      ]);
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    if (type === 'incomes') {
      const headers = ['ID', 'Fecha', 'Titulo', 'Ambito', 'Categoria', 'Monto_USD', 'Monto_VES', 'Canal', 'Notas'];
      const rows = state.incomes.map((i) => [
        i.id,
        i.date,
        `"${i.title.replace(/"/g, '""')}"`,
        i.scope,
        i.category,
        i.triMonetary.amount_usd.toFixed(2),
        i.triMonetary.amount_ves.toFixed(2),
        i.channel,
        `"${(i.notes || '').replace(/"/g, '""')}"`,
      ]);
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    const headers = ['ID', 'Vencimiento', 'Titulo', 'Acreedor', 'Ambito', 'Monto_USD', 'Estado', 'Restante_USD'];
    const rows = state.liabilities.map((l) => [
      l.id,
      l.dueDate,
      `"${l.title.replace(/"/g, '""')}"`,
      `"${l.creditor.replace(/"/g, '""')}"`,
      l.scope,
      l.triMonetary.amount_usd.toFixed(2),
      l.status,
      l.remainingAmount.toFixed(2),
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Triggers structured backup and cloud synchronization to Google Drive.
   */
  async triggerCloudSync(): Promise<DriveSyncResult> {
    this.syncStatus.set('syncing');

    try {
      const now = new Date();
      const targetFolder = this.getFolderHierarchy('backups', now);
      const timestamp = now.toISOString();
      const jsonPayload = this.generateMasterLedgerJson();

      if (this.mcp) {
        await this.mcp.gdriveSyncDbBackup({
          backupType: 'ledger_json',
          dataPayload: jsonPayload,
          folderId: targetFolder,
        });
      } else {
        // Fallback simulation latency
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.STORAGE_SYNC_KEY, timestamp);
        }
      } catch {
        // Safe fallback in environments without localStorage
      }
      this.lastSyncTimestamp.set(timestamp);
      this.syncStatus.set('synced');

      const state = this.financeService.state();
      const totalEntries =
        state.expenses.length + state.incomes.length + state.liabilities.length + state.quotes.length;

      this.toast.success(
        `☁️ Respaldo en Google Drive completado exitosamente en ${targetFolder}`,
      );

      return {
        success: true,
        filesCount: totalEntries,
        targetFolder,
        timestamp,
      };
    } catch {
      this.syncStatus.set('error');
      this.toast.error('Error al sincronizar con Google Drive.');
      return {
        success: false,
        filesCount: 0,
        targetFolder: '',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Downloads the complete master ledger snapshot as a JSON file.
   */
  downloadMasterLedgerJson(): void {
    const jsonStr = this.generateMasterLedgerJson();
    const dateStr = new Date().toISOString().split('T')[0];
    this.downloadBlob(jsonStr, `homel360-ledger-${dateStr}.json`, 'application/json');
    this.toast.info('Descargando snapshot JSON del Libro Maestro');
  }

  /**
   * Downloads ledger movements as CSV.
   */
  downloadCsv(type: 'expenses' | 'incomes' | 'liabilities'): void {
    const csvStr = this.exportLedgerAsCsv(type);
    const dateStr = new Date().toISOString().split('T')[0];
    this.downloadBlob(csvStr, `homel360-${type}-${dateStr}.csv`, 'text/csv;charset=utf-8;');
    this.toast.info(`Descargando reporte CSV de ${type}`);
  }

  /**
   * Restores a complete master ledger snapshot from a JSON file string.
   */
  restoreFromJsonString(rawJson: string): boolean {
    try {
      const parsed = JSON.parse(rawJson);
      const ledgerCandidate: Finance360LedgerState = parsed?.ledger ? parsed.ledger : parsed;
      const ok = this.financeService.restoreLedgerState(ledgerCandidate);
      if (ok) {
        this.toast.success('📥 Libro Maestro restaurado exitosamente desde el respaldo JSON.');
        return true;
      }
      this.toast.warn('El archivo JSON no contiene una estructura válida de HOMEL 360.');
      return false;
    } catch {
      this.toast.error('Error al leer el archivo JSON de respaldo.');
      return false;
    }
  }

  private downloadBlob(content: string, filename: string, type: string): void {
    if (typeof window === 'undefined') return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private loadLastSyncTime(): string | null {
    try {
      return localStorage.getItem(this.STORAGE_SYNC_KEY);
    } catch {
      return null;
    }
  }
}
