import { describe, it, expect } from 'vitest';
import {
  SyncHubEngine,
  formatSyncStatusTelegramMessage,
  type SyncRecord,
} from './sync-hub';

describe('Zero-Knowledge Multi-Device Sync Hub Engine', () => {
  it('initializes with default empty state and version 0', () => {
    const hub = new SyncHubEngine();
    const stats = hub.getStats();

    expect(stats.serverVersion).toBe(0);
    expect(stats.totalRecords).toBe(0);
    expect(stats.connectedDevices).toBe(0);
    expect(stats.lastSyncAt).toBeNull();
  });

  it('accepts pushed records and increments monotonic server version', () => {
    const hub = new SyncHubEngine();

    const pushResult = hub.pushChanges({
      deviceId: 'desktop-electron-main',
      records: [
        {
          id: 'OP-001',
          collection: 'operations',
          updatedAt: 1700000000,
          deviceId: 'desktop-electron-main',
          encryptedPayload: 'ENCRYPTED_AES256_BASE64_OP1',
        },
        {
          id: 'ACC-banesco',
          collection: 'accounts',
          updatedAt: 1700000000,
          deviceId: 'desktop-electron-main',
          encryptedPayload: 'ENCRYPTED_AES256_BASE64_ACC1',
        },
      ],
    });

    expect(pushResult.acceptedCount).toBe(2);
    expect(pushResult.rejectedCount).toBe(0);
    expect(pushResult.serverVersion).toBe(2);

    const stats = hub.getStats();
    expect(stats.totalRecords).toBe(2);
    expect(stats.connectedDevices).toBe(1);
    expect(stats.lastSyncAt).not.toBeNull();
  });

  it('pulls only incremental delta based on clientVersion', () => {
    const hub = new SyncHubEngine();

    hub.pushChanges({
      deviceId: 'desktop',
      records: [
        {
          id: 'OP-1',
          collection: 'operations',
          updatedAt: 100,
          deviceId: 'desktop',
          encryptedPayload: 'OP1',
        },
      ],
    });

    hub.pushChanges({
      deviceId: 'desktop',
      records: [
        {
          id: 'OP-2',
          collection: 'operations',
          updatedAt: 200,
          deviceId: 'desktop',
          encryptedPayload: 'OP2',
        },
      ],
    });

    // Device with clientVersion 0 gets both records
    const fullPull = hub.pullChanges(0, 'mobile');
    expect(fullPull.records.length).toBe(2);
    expect(fullPull.serverVersion).toBe(2);

    // Device with clientVersion 1 gets only the second record
    const deltaPull = hub.pullChanges(1, 'mobile');
    expect(deltaPull.records.length).toBe(1);
    expect(deltaPull.records[0].id).toBe('OP-2');
    expect(deltaPull.records[0].version).toBe(2);
  });

  it('resolves conflicts via Last-Write-Wins (LWW)', () => {
    const hub = new SyncHubEngine();

    // 1. Initial write
    hub.pushChanges({
      deviceId: 'desktop',
      records: [
        {
          id: 'OP-1',
          collection: 'operations',
          updatedAt: 1000,
          deviceId: 'desktop',
          encryptedPayload: 'PAYLOAD_INITIAL',
        },
      ],
    });

    // 2. Outdated write arrives later from offline mobile (updatedAt: 500 < 1000)
    const stalePush = hub.pushChanges({
      deviceId: 'mobile',
      records: [
        {
          id: 'OP-1',
          collection: 'operations',
          updatedAt: 500,
          deviceId: 'mobile',
          encryptedPayload: 'STALE_PAYLOAD',
        },
      ],
    });

    expect(stalePush.acceptedCount).toBe(0);
    expect(stalePush.rejectedCount).toBe(1);

    // Current state in hub remains PAYLOAD_INITIAL
    const pull = hub.pullChanges(0);
    expect(pull.records[0].encryptedPayload).toBe('PAYLOAD_INITIAL');

    // 3. Fresh write arrives (updatedAt: 2000 > 1000)
    const freshPush = hub.pushChanges({
      deviceId: 'mobile',
      records: [
        {
          id: 'OP-1',
          collection: 'operations',
          updatedAt: 2000,
          deviceId: 'mobile',
          encryptedPayload: 'FRESH_PAYLOAD',
        },
      ],
    });

    expect(freshPush.acceptedCount).toBe(1);
    expect(hub.pullChanges(0).records[0].encryptedPayload).toBe('FRESH_PAYLOAD');
  });

  it('tracks soft deleted tombstones accurately', () => {
    const hub = new SyncHubEngine();

    hub.pushChanges({
      deviceId: 'desktop',
      records: [
        {
          id: 'OP-1',
          collection: 'operations',
          updatedAt: 1000,
          deviceId: 'desktop',
          encryptedPayload: 'OP1',
          deleted: true,
        },
      ],
    });

    const stats = hub.getStats();
    expect(stats.totalRecords).toBe(1);
    expect(stats.activeRecords).toBe(0);
    expect(stats.tombstones).toBe(1);
  });

  it('formats Telegram sync status MarkdownV2 report', () => {
    const hub = new SyncHubEngine();
    hub.pushChanges({
      deviceId: 'desktop-main',
      records: [
        {
          id: 'ACC-1',
          collection: 'accounts',
          updatedAt: Date.now(),
          deviceId: 'desktop-main',
          encryptedPayload: 'BLOB',
        },
      ],
    });

    const msg = formatSyncStatusTelegramMessage(hub.getStats());
    expect(msg).toContain('HUB DE SINCRONIZACIÓN CIFRADA E2E');
    expect(msg).toContain('AES-256-GCM');
    expect(msg).toContain('v1');
    expect(msg).toContain('Dispositivos Vinculados: `1`');
  });
});
