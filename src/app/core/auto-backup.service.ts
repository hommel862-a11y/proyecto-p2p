import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';
import { createChecksummedBackup, verifyBackupIntegrity, type ChecksummedBackup } from '@p2p/core';

export interface SnapshotMeta {
  date: string; // YYYY-MM-DD
  timestamp: string;
  operationsCount: number;
  checksumSha256?: string;
}

export interface BackupPayload {
  version: number;
  exportedAt: string;
  operations: unknown[];
  accounts?: unknown[];
  counterparties?: unknown[];
  riskRules?: unknown;
}

const INDEX_KEY = 'p2p.snapshots.index';
const SNAPSHOT_PREFIX = 'p2p.snapshot.';
const MAX_SNAPSHOTS = 7;

@Injectable({ providedIn: 'root' })
export class AutoBackupService {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly audit = inject(AuditLoggerService);

  readonly snapshots = signal<SnapshotMeta[]>([]);

  constructor() {
    this.refreshSnapshots();
    this.checkAndAutoSnapshot();
  }

  refreshSnapshots(): void {
    const list = this.storage.get<SnapshotMeta[]>(INDEX_KEY) ?? [];
    this.snapshots.set(list);
  }

  checkAndAutoSnapshot(): void {
    const today = new Date().toISOString().slice(0, 10);
    const existing = this.storage.get<unknown>(SNAPSHOT_PREFIX + today);
    if (!existing) {
      this.createSnapshot(today, true);
    }
  }

  createSnapshot(dateKey = new Date().toISOString().slice(0, 10), silent = false): void {
    const ops = this.storage.get<unknown[]>('p2p.operations') ?? [];
    const accounts = this.storage.get<unknown[]>('p2p.accounts') ?? [];
    const counterparties = this.storage.get<unknown[]>('p2p.counterparties') ?? [];
    const riskRules = this.storage.get<unknown>('p2p.risk-rules') ?? null;

    const payload: BackupPayload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      operations: ops,
      accounts,
      counterparties,
      riskRules,
    };

    const checksummed = createChecksummedBackup(payload);

    try {
      this.storage.set(SNAPSHOT_PREFIX + dateKey, checksummed);

      let list = this.storage.get<SnapshotMeta[]>(INDEX_KEY) ?? [];
      list = list.filter((s) => s.date !== dateKey);
      list.unshift({
        date: dateKey,
        timestamp: payload.exportedAt,
        operationsCount: ops.length,
        checksumSha256: checksummed.checksumSha256,
      });

      // Prune older snapshots
      if (list.length > MAX_SNAPSHOTS) {
        const toRemove = list.slice(MAX_SNAPSHOTS);
        for (const item of toRemove) {
          this.storage.remove(SNAPSHOT_PREFIX + item.date);
        }
        list = list.slice(0, MAX_SNAPSHOTS);
      }

      this.storage.set(INDEX_KEY, list);
      this.snapshots.set(list);

      this.audit.log(
        'DATA_BACKUP',
        `Snapshot ${dateKey} creado con checksum SHA-256`,
        { operations: ops.length, sha256: checksummed.checksumSha256 },
        'info',
      );

      if (!silent) {
        this.toast.success(
          `Snapshot del día ${dateKey} guardado con verificación criptográfica.`,
          'Auto-Backup',
        );
      }
    } catch (err) {
      console.error('[AutoBackupService] Error saving snapshot:', err);
    }
  }

  restoreSnapshot(dateKey: string): boolean {
    const raw = this.storage.get<unknown>(SNAPSHOT_PREFIX + dateKey);
    if (!raw) {
      this.toast.error('No se encontró el snapshot seleccionado.', 'Error');
      return false;
    }

    let payload: BackupPayload;

    // Check if it's v2 checksummed format
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'format' in raw &&
      (raw as { format: string }).format === 'p2p-backup-v2'
    ) {
      const checksummed = raw as ChecksummedBackup<BackupPayload>;
      const integrity = verifyBackupIntegrity(checksummed);

      if (!integrity.isValid) {
        this.audit.log(
          'SECURITY_ALERT',
          `Fallo de integridad en restauración de snapshot ${dateKey}`,
          { expected: integrity.expectedChecksum, actual: integrity.actualChecksum },
          'error',
        );
        this.toast.error(
          'ALERTA CRÍTICA: El snapshot falló la verificación de integridad SHA-256. Podría estar corrupto.',
          'Error de Seguridad',
        );
        return false;
      }

      payload = checksummed.payload;
    } else {
      // Legacy v1 snapshot fallback
      payload = raw as BackupPayload;
    }

    if (!payload || !Array.isArray(payload.operations)) {
      this.toast.error('Estructura de snapshot inválida.', 'Error');
      return false;
    }

    try {
      this.storage.set('p2p.operations', payload.operations);
      if (payload.accounts) this.storage.set('p2p.accounts', payload.accounts);
      if (payload.counterparties) this.storage.set('p2p.counterparties', payload.counterparties);
      if (payload.riskRules) this.storage.set('p2p.risk-rules', payload.riskRules);

      this.audit.log(
        'DATA_RESTORE',
        `Snapshot ${dateKey} restaurado exitosamente`,
        { operationsCount: payload.operations.length },
        'info',
      );

      this.toast.success(
        `Restauradas ${payload.operations.length} operaciones del snapshot ${dateKey}.`,
        'Restauración Exitosa',
      );

      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
      return true;
    } catch (err) {
      this.toast.error((err as Error).message || 'Falla al restaurar', 'Error');
      return false;
    }
  }

  downloadSnapshot(dateKey: string): void {
    const data = this.storage.get<unknown>(SNAPSHOT_PREFIX + dateKey);
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-snapshot-${dateKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.info(`Descargado snapshot ${dateKey} con checksum criptográfico.`, 'Descarga');
  }
}
