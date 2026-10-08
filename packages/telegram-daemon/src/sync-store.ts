/**
 * Server-Side Zero-Knowledge Encrypted Sync Store for VPS Telegram Daemon.
 * Persists opaque encrypted records to disk and coordinates multi-device syncing.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  SyncHubEngine,
  formatSyncStatusTelegramMessage,
  type SyncPushRequest,
  type SyncPushResult,
  type SyncPullResponse,
  type SyncHubStats,
  type SyncRecord,
} from '@p2p/core';

export class EncryptedSyncStore {
  private engine: SyncHubEngine;
  private filePath: string;

  constructor(filePath = path.resolve(process.cwd(), '.encrypted_sync_store.json')) {
    this.filePath = filePath;
    const initialRecords = this.loadFromDisk();
    this.engine = new SyncHubEngine(initialRecords);
  }

  private loadFromDisk(): SyncRecord[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('[SyncStore] No se pudo leer el archivo de sincronización previa:', err);
    }
    return [];
  }

  private saveToDisk(): void {
    try {
      const records = this.engine.getAllRecords();
      fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SyncStore] Error al guardar datos cifrados en disco:', err);
    }
  }

  public push(request: SyncPushRequest): SyncPushResult {
    const result = this.engine.pushChanges(request);
    if (result.acceptedCount > 0) {
      this.saveToDisk();
    }
    return result;
  }

  public pull(clientVersion = 0, deviceId?: string): SyncPullResponse {
    return this.engine.pullChanges(clientVersion, deviceId);
  }

  public getStats(): SyncHubStats {
    return this.engine.getStats();
  }

  public getTelegramStatusMessage(): string {
    return formatSyncStatusTelegramMessage(this.engine.getStats());
  }
}
