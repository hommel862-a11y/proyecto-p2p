import { Injectable, inject, signal } from '@angular/core';
import { Finance360Service } from '../finance-360.service';
import { ToastService } from '../toast.service';
import { McpService } from '../mcp.service';
import { StorageService } from '../storage';
import type { Finance360LedgerState } from '../models/finance-360.models';

export const DRIVE_SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

export type DriveSyncStatus = (typeof DRIVE_SYNC_STATUS)[keyof typeof DRIVE_SYNC_STATUS];

export const DRIVE_SYNC_MODE = {
  LIVE: 'live',
  SIMULATED: 'simulated',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

export type DriveSyncMode = (typeof DRIVE_SYNC_MODE)[keyof typeof DRIVE_SYNC_MODE];

export interface DriveSyncResult {
  success: boolean;
  mode: DriveSyncMode;
  filesCount: number;
  targetFolder: string;
  timestamp: string;
  fileId?: string;
  webViewLink?: string;
  reason?: string;
}

interface DriveBackupRequest {
  backupType: 'ledger_json' | 'sqlite_dump' | 'audit_snapshot';
  dataPayload: string;
  folderPath: string;
  folderId?: string;
  encrypt: boolean;
}

interface ParsedMcpDrivePayload {
  success?: boolean;
  mode?: string;
  simulated?: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
}

const STORAGE_SYNC_KEY = 'p2p.finance360.last_drive_sync';
const STORAGE_DRIVE_FOLDER_ID_KEY = 'p2p.finance360.drive_folder_id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractDrivePayload(response: unknown): ParsedMcpDrivePayload | null {
  if (!isRecord(response)) return null;

  const candidate = isRecord(response['data'])
    ? response['data']
    : isRecord(response['result'])
      ? response['result']
      : response;

  // Handle MCP stdio tool envelope `{ content: [{ type: 'text', text: '{...}' }] }`
  const contentList = candidate['content'];
  if (Array.isArray(contentList) && contentList.length > 0 && isRecord(contentList[0])) {
    const textVal = contentList[0]['text'];
    if (typeof textVal === 'string') {
      try {
        const parsed: unknown = JSON.parse(textVal);
        if (isRecord(parsed)) {
          return {
            success: typeof parsed['success'] === 'boolean' ? parsed['success'] : undefined,
            mode: typeof parsed['mode'] === 'string' ? parsed['mode'] : undefined,
            simulated: typeof parsed['simulated'] === 'boolean' ? parsed['simulated'] : undefined,
            fileId: typeof parsed['fileId'] === 'string' ? parsed['fileId'] : undefined,
            webViewLink:
              typeof parsed['webViewLink'] === 'string' ? parsed['webViewLink'] : undefined,
            error: typeof parsed['error'] === 'string' ? parsed['error'] : undefined,
          };
        }
      } catch {
        // Not JSON; fall through to top-level fields
      }
    }
  }

  return {
    success: typeof candidate['success'] === 'boolean' ? candidate['success'] : undefined,
    mode:
      typeof candidate['mode'] === 'string'
        ? candidate['mode']
        : typeof response['mode'] === 'string'
          ? response['mode']
          : undefined,
    simulated:
      typeof candidate['simulated'] === 'boolean'
        ? candidate['simulated']
        : typeof response['simulated'] === 'boolean'
          ? response['simulated']
          : undefined,
    fileId: typeof candidate['fileId'] === 'string' ? candidate['fileId'] : undefined,
    webViewLink:
      typeof candidate['webViewLink'] === 'string' ? candidate['webViewLink'] : undefined,
    error:
      typeof candidate['error'] === 'string'
        ? candidate['error']
        : typeof response['error'] === 'string'
          ? response['error']
          : undefined,
  };
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (
      typeof globalThis.localStorage !== 'undefined' &&
      typeof globalThis.localStorage?.getItem === 'function' &&
      typeof globalThis.localStorage?.setItem === 'function'
    ) {
      return globalThis.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class FinanceDriveSyncService {
  private readonly financeService = inject(Finance360Service);
  private readonly toast = inject(ToastService);
  private readonly mcp = inject(McpService, { optional: true });
  private readonly storage = inject(StorageService, { optional: true });

  readonly syncStatus = signal<DriveSyncStatus>(DRIVE_SYNC_STATUS.IDLE);
  readonly lastSyncTimestamp = signal<string | null>(this.loadLastSyncTime());

  /**
   * Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) and wraps
   * cell values according to RFC 4180 double-quote escaping.
   */
  sanitizeCsvCell(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value);
    const needsPrefix = /^[\t\r=+\-@]/.test(str) || /^[=+\-@]/.test(str.trimStart());
    const safe = needsPrefix ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  /**
   * Reads an optional configured Google Drive folder ID, rejecting Unix paths.
   */
  getConfiguredDriveFolderId(): string | undefined {
    try {
      const fromStorage = this.storage?.get<string>(STORAGE_DRIVE_FOLDER_ID_KEY);
      const fromLocal = getSafeLocalStorage()?.getItem(STORAGE_DRIVE_FOLDER_ID_KEY);
      const raw = (typeof fromStorage === 'string' ? fromStorage : fromLocal)?.trim();
      if (!raw || raw.includes('/') || raw.includes('\\')) return undefined;
      return raw;
    } catch {
      return undefined;
    }
  }

  /**
   * Generates hierarchical path for storing artifacts in Google Drive:
   * e.g. /Finanzas_360/2026/10_Octubre/Recibos_Efectivo/
   */
  getFolderHierarchy(
    category: 'receipts' | 'invoices' | 'quotes' | 'backups',
    date: Date = new Date(),
  ): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
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
   * Generates RFC 4180 CSV with formula-injection neutralization for Google Sheets / Excel.
   */
  exportLedgerAsCsv(type: 'expenses' | 'incomes' | 'liabilities'): string {
    const state = this.financeService.state();

    if (type === 'expenses') {
      const headers = [
        'ID',
        'Fecha',
        'Titulo',
        'Ambito',
        'Categoria',
        'Monto_USD',
        'Monto_VES',
        'Canal',
        'Notas',
      ];
      const rows = state.expenses.map((e) =>
        [
          e.id,
          e.date,
          e.title,
          e.scope,
          e.category,
          e.triMonetary.amount_usd.toFixed(2),
          e.triMonetary.amount_ves.toFixed(2),
          e.channel,
          e.notes ?? '',
        ].map((cell) => this.sanitizeCsvCell(cell)),
      );
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    if (type === 'incomes') {
      const headers = [
        'ID',
        'Fecha',
        'Titulo',
        'Ambito',
        'Categoria',
        'Monto_USD',
        'Monto_VES',
        'Canal',
        'Notas',
      ];
      const rows = state.incomes.map((i) =>
        [
          i.id,
          i.date,
          i.title,
          i.scope,
          i.category,
          i.triMonetary.amount_usd.toFixed(2),
          i.triMonetary.amount_ves.toFixed(2),
          i.channel,
          i.notes ?? '',
        ].map((cell) => this.sanitizeCsvCell(cell)),
      );
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    const headers = [
      'ID',
      'Vencimiento',
      'Titulo',
      'Acreedor',
      'Ambito',
      'Monto_USD',
      'Estado',
      'Restante_USD',
    ];
    const rows = state.liabilities.map((l) =>
      [
        l.id,
        l.dueDate,
        l.title,
        l.creditor,
        l.scope,
        l.triMonetary.amount_usd.toFixed(2),
        l.status,
        l.remainingAmount.toFixed(2),
      ].map((cell) => this.sanitizeCsvCell(cell)),
    );
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  /**
   * Triggers structured backup and cloud synchronization to Google Drive.
   * Honestly distinguishes live cloud uploads from disconnected or simulated transports.
   */
  async triggerCloudSync(): Promise<DriveSyncResult> {
    const now = new Date();
    const targetFolder = this.getFolderHierarchy('backups', now);
    const timestamp = now.toISOString();

    if (!this.mcp) {
      this.syncStatus.set(DRIVE_SYNC_STATUS.DISCONNECTED);
      this.toast.warn(
        'Google Drive no está conectado en este entorno. Usa "Exportar JSON" para resguardo local.',
        'Google Drive',
      );
      return {
        success: false,
        mode: DRIVE_SYNC_MODE.DISCONNECTED,
        filesCount: 0,
        targetFolder,
        timestamp,
        reason: 'mcp_unavailable',
      };
    }

    this.syncStatus.set(DRIVE_SYNC_STATUS.SYNCING);

    try {
      const jsonPayload = this.generateMasterLedgerJson();
      const configuredDriveFolderId = this.getConfiguredDriveFolderId();

      const request: DriveBackupRequest = {
        backupType: 'ledger_json',
        dataPayload: jsonPayload,
        folderPath: targetFolder,
        folderId: configuredDriveFolderId || undefined,
        encrypt: true,
      };

      const response = await this.mcp.gdriveSyncDbBackup(request);
      const payload = extractDrivePayload(response);

      const topFailed = !response || response.success === false;
      const innerFailed = payload?.success === false;
      if (topFailed || innerFailed) {
        this.syncStatus.set(DRIVE_SYNC_STATUS.ERROR);
        const errorDetail = payload?.error || response?.error || 'Fallo de sincronización.';
        this.toast.error(`Error al sincronizar con Google Drive: ${errorDetail}`, 'Google Drive');
        return {
          success: false,
          mode: DRIVE_SYNC_MODE.ERROR,
          filesCount: 0,
          targetFolder,
          timestamp,
          reason: errorDetail,
        };
      }

      const normalizedMode = (payload?.mode ?? '').trim().toUpperCase();
      const isSimulated =
        payload?.simulated === true ||
        normalizedMode === 'SIMULATED' ||
        normalizedMode === 'MOCK' ||
        (typeof this.mcp.hasNativeTransport === 'function' &&
          !this.mcp.hasNativeTransport() &&
          normalizedMode !== 'LIVE');

      if (isSimulated) {
        this.syncStatus.set(DRIVE_SYNC_STATUS.DISCONNECTED);
        this.toast.warn(
          'Google Drive opera en modo simulado sin credenciales activas. El archivo no se subió a la nube; usa "Exportar JSON" para respaldo local.',
          'Google Drive',
        );
        return {
          success: false,
          mode: DRIVE_SYNC_MODE.SIMULATED,
          filesCount: 0,
          targetFolder,
          timestamp,
          reason: 'simulated_transport',
        };
      }

      if (normalizedMode !== 'LIVE') {
        this.syncStatus.set(DRIVE_SYNC_STATUS.DISCONNECTED);
        this.toast.warn(
          'No se pudo verificar la conexión en vivo con Google Drive. Usa "Exportar JSON" para respaldo local.',
          'Google Drive',
        );
        return {
          success: false,
          mode: DRIVE_SYNC_MODE.DISCONNECTED,
          filesCount: 0,
          targetFolder,
          timestamp,
          reason: 'unverified_transport',
        };
      }

      try {
        this.storage?.set(STORAGE_SYNC_KEY, timestamp);
        getSafeLocalStorage()?.setItem(STORAGE_SYNC_KEY, timestamp);
      } catch {
        // Safe fallback in environments without localStorage
      }
      this.lastSyncTimestamp.set(timestamp);
      this.syncStatus.set(DRIVE_SYNC_STATUS.SYNCED);

      const state = this.financeService.state();
      const totalEntries =
        state.expenses.length +
        state.incomes.length +
        state.liabilities.length +
        state.quotes.length;

      this.toast.success(
        `Respaldo en Google Drive completado exitosamente en ${targetFolder}`,
        'Google Drive',
      );

      return {
        success: true,
        mode: DRIVE_SYNC_MODE.LIVE,
        filesCount: totalEntries,
        targetFolder,
        timestamp,
        fileId: payload?.fileId,
        webViewLink: payload?.webViewLink,
      };
    } catch (err: unknown) {
      this.syncStatus.set(DRIVE_SYNC_STATUS.ERROR);
      const reason = err instanceof Error ? err.message : 'Error inesperado';
      this.toast.error('Error al sincronizar con Google Drive.', 'Google Drive');
      return {
        success: false,
        mode: DRIVE_SYNC_MODE.ERROR,
        filesCount: 0,
        targetFolder,
        timestamp: new Date().toISOString(),
        reason,
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
      const parsed: unknown = JSON.parse(rawJson);
      const ledgerCandidate = (
        isRecord(parsed) && isRecord(parsed['ledger']) ? parsed['ledger'] : parsed
      ) as Finance360LedgerState;
      const ok = this.financeService.restoreLedgerState(ledgerCandidate);
      if (ok) {
        this.toast.success('Libro Maestro restaurado exitosamente desde el respaldo JSON.');
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
      const fromStorage = this.storage?.get<string>(STORAGE_SYNC_KEY);
      if (typeof fromStorage === 'string' && fromStorage.length > 0) {
        return fromStorage;
      }
      return getSafeLocalStorage()?.getItem(STORAGE_SYNC_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
