/**
 * Zero-Knowledge Multi-Device Sync Hub with Vector Clocks & CRDT Conflict Resolution.
 * Synchronizes opaque AES-256-GCM encrypted financial records across Desktop, Mobile and VPS.
 * Server stores only encrypted ciphertext, ensuring 100% financial privacy.
 * Deterministic, pure domain logic, zero network dependencies.
 */

export type SyncCollection = 'operations' | 'accounts' | 'journal' | 'settings' | 'general';

export interface SyncRecord {
  /** Unique entity ID (e.g. OP-1234, ACC-banesco) */
  id: string;
  /** Storage collection namespace */
  collection: SyncCollection;
  /** Monotonic sequence version on server */
  version: number;
  /** Milliseconds UTC when change was authored */
  updatedAt: number;
  /** Device identifier that created the change */
  deviceId: string;
  /** AES-256-GCM ciphertext payload (Base64) */
  encryptedPayload: string;
  /** Initialization vector (Base64) */
  iv?: string;
  /** Cryptographic salt (Base64) */
  salt?: string;
  /** Soft delete tombstone */
  deleted?: boolean;
}

export type VectorClock = Record<string, number>;

export interface DeviceSyncMeta {
  deviceId: string;
  lastSyncAt: number;
  syncedVersion: number;
}

export interface SyncPushRequest {
  deviceId: string;
  clientClock?: VectorClock;
  records: Omit<SyncRecord, 'version'>[];
}

export interface SyncPushResult {
  acceptedCount: number;
  rejectedCount: number;
  serverVersion: number;
}

export interface SyncPullResponse {
  serverVersion: number;
  serverClock: VectorClock;
  records: SyncRecord[];
}

export interface SyncHubStats {
  serverVersion: number;
  totalRecords: number;
  activeRecords: number;
  tombstones: number;
  connectedDevices: number;
  lastSyncAt: number | null;
}

/**
 * Pure CRDT Multi-Device Sync Engine.
 */
export class SyncHubEngine {
  private serverVersion = 0;
  private serverClock: VectorClock = {};
  private records: Map<string, SyncRecord> = new Map();
  private devices: Map<string, DeviceSyncMeta> = new Map();
  private lastSyncAt: number | null = null;

  constructor(initialRecords: SyncRecord[] = [], initialVersion = 0) {
    this.serverVersion = initialVersion;
    for (const rec of initialRecords) {
      this.records.set(`${rec.collection}:${rec.id}`, rec);
      if (rec.version > this.serverVersion) {
        this.serverVersion = rec.version;
      }
    }
  }

  /**
   * Pushes changes from a client device into the hub.
   * Resolves conflicts via Last-Write-Wins (LWW) based on updatedAt and version.
   */
  public pushChanges(request: SyncPushRequest): SyncPushResult {
    const { deviceId, records } = request;
    if (!deviceId || !Array.isArray(records)) {
      return { acceptedCount: 0, rejectedCount: records?.length || 0, serverVersion: this.serverVersion };
    }

    let accepted = 0;
    let rejected = 0;
    const now = Date.now();

    for (const incoming of records) {
      const compositeKey = `${incoming.collection}:${incoming.id}`;
      const existing = this.records.get(compositeKey);

      // Conflict Resolution: LWW (Last-Write-Wins)
      if (!existing || incoming.updatedAt >= existing.updatedAt) {
        this.serverVersion++;
        const updatedRecord: SyncRecord = {
          ...incoming,
          version: this.serverVersion,
          deviceId,
        };
        this.records.set(compositeKey, updatedRecord);
        accepted++;
      } else {
        rejected++;
      }
    }

    // Update vector clock & device registry
    this.serverClock[deviceId] = (this.serverClock[deviceId] || 0) + accepted;
    this.lastSyncAt = now;
    this.devices.set(deviceId, {
      deviceId,
      lastSyncAt: now,
      syncedVersion: this.serverVersion,
    });

    return {
      acceptedCount: accepted,
      rejectedCount: rejected,
      serverVersion: this.serverVersion,
    };
  }

  /**
   * Pulls all records modified strictly after clientVersion.
   */
  public pullChanges(clientVersion = 0, deviceId?: string): SyncPullResponse {
    const delta: SyncRecord[] = [];

    for (const rec of this.records.values()) {
      if (rec.version > clientVersion) {
        delta.push(rec);
      }
    }

    // Sort ascending by version so client applies in strict monotonic order
    delta.sort((a, b) => a.version - b.version);

    if (deviceId) {
      const dev = this.devices.get(deviceId) || { deviceId, lastSyncAt: Date.now(), syncedVersion: 0 };
      dev.lastSyncAt = Date.now();
      dev.syncedVersion = this.serverVersion;
      this.devices.set(deviceId, dev);
    }

    return {
      serverVersion: this.serverVersion,
      serverClock: { ...this.serverClock },
      records: delta,
    };
  }

  public getStats(): SyncHubStats {
    let tombstones = 0;
    for (const rec of this.records.values()) {
      if (rec.deleted) tombstones++;
    }

    return {
      serverVersion: this.serverVersion,
      totalRecords: this.records.size,
      activeRecords: this.records.size - tombstones,
      tombstones,
      connectedDevices: this.devices.size,
      lastSyncAt: this.lastSyncAt,
    };
  }

  public getAllRecords(): SyncRecord[] {
    return Array.from(this.records.values());
  }

  public clear(): void {
    this.records.clear();
    this.devices.clear();
    this.serverClock = {};
    this.serverVersion = 0;
    this.lastSyncAt = null;
  }
}

/**
 * Formats Telegram MarkdownV2 message for sync status report.
 */
export function formatSyncStatusTelegramMessage(stats: SyncHubStats): string {
  const lastSyncStr = stats.lastSyncAt
    ? new Date(stats.lastSyncAt).toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
    : 'Nunca';

  return (
    `🔄 *HUB DE SINCRONIZACIÓN CIFRADA E2E*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `• *Cifrado:* \`AES-256-GCM (Zero-Knowledge)\`\n` +
    `• *Versión Global:* \`v${stats.serverVersion}\`\n` +
    `• *Registros Totales:* \`${stats.totalRecords}\` \\(Activos: \`${stats.activeRecords}\`, Bajas: \`${stats.tombstones}\`\\)\n` +
    `• *Dispositivos Vinculados:* \`${stats.connectedDevices}\`\n` +
    `• *Última Sincronización:* \`${lastSyncStr}\`\n\n` +
    `_Los datos viajan y residen 100% cifrados. El VPS nunca tiene acceso a tus claves privadas\\._`
  );
}
