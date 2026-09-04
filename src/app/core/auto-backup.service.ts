import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { ToastService } from './toast.service';

export interface SnapshotMeta {
  date: string; // YYYY-MM-DD
  timestamp: string;
  operationsCount: number;
}

export interface BackupPayload {
  version: 1;
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
    const existing = this.storage.get<BackupPayload>(SNAPSHOT_PREFIX + today);
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
      version: 1,
      exportedAt: new Date().toISOString(),
      operations: ops,
      accounts,
      counterparties,
      riskRules,
    };

    try {
      this.storage.set(SNAPSHOT_PREFIX + dateKey, payload);

      let list = this.storage.get<SnapshotMeta[]>(INDEX_KEY) ?? [];
      list = list.filter((s) => s.date !== dateKey);
      list.unshift({
        date: dateKey,
        timestamp: payload.exportedAt,
        operationsCount: ops.length,
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

      if (!silent) {
        this.toast.success(`Snapshot del día ${dateKey} guardado con éxito.`, 'Auto-Backup');
      }
    } catch {
      // Storage quota or error
    }
  }

  restoreSnapshot(dateKey: string): boolean {
    const data = this.storage.get<BackupPayload>(SNAPSHOT_PREFIX + dateKey);
    if (!data || !Array.isArray(data.operations)) {
      this.toast.error('No se pudo restaurar el snapshot seleccionado.', 'Error');
      return false;
    }

    try {
      this.storage.set('p2p.operations', data.operations);
      if (data.accounts) this.storage.set('p2p.accounts', data.accounts);
      if (data.counterparties) this.storage.set('p2p.counterparties', data.counterparties);
      if (data.riskRules) this.storage.set('p2p.risk-rules', data.riskRules);

      this.toast.success(
        `Restauradas ${data.operations.length} operaciones del snapshot ${dateKey}.`,
        'Restauración Exitosa',
      );
      // Small reload to re-read all signal state
      window.location.reload();
      return true;
    } catch (err) {
      this.toast.error((err as Error).message || 'Falla al restaurar', 'Error');
      return false;
    }
  }

  downloadSnapshot(dateKey: string): void {
    const data = this.storage.get<BackupPayload>(SNAPSHOT_PREFIX + dateKey);
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p-snapshot-${dateKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.info(`Descargado snapshot ${dateKey}.`, 'Descarga');
  }
}
