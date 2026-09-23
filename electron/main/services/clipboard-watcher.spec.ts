import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ClipboardWatcherService,
  type ClipboardReader,
} from './clipboard-watcher';
import type { P2PDatabaseService } from '../db/database';
import type { BrowserWindow } from 'electron';

describe('ClipboardWatcherService', () => {
  let mockDb: Partial<P2PDatabaseService>;
  let mockWin: {
    isDestroyed: () => boolean;
    isFocused: () => boolean;
    isMinimized: () => boolean;
    webContents: {
      send: ReturnType<typeof vi.fn>;
    };
  };
  let clipboardText: string;
  let mockReader: ClipboardReader;

  beforeEach(() => {
    clipboardText = '';
    mockReader = {
      readText: () => clipboardText,
    };
    mockWin = {
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false,
      webContents: {
        send: vi.fn(),
      },
    };
    mockDb = {
      findBlacklistMatches: vi.fn().mockReturnValue([]),
    };
  });

  it('detects a Banesco Pago Móvil receipt and sends IPC event', async () => {
    const watcher = new ClipboardWatcherService(
      mockDb as P2PDatabaseService,
      () => mockWin as unknown as BrowserWindow,
      mockReader,
    );

    clipboardText =
      'Banesco: Pago Movil recibido por 1.250,50 Bs de Juan Perez CI 18.234.567 con referencia 984721. 22/09/2026';

    const result = await watcher.pollClipboard();

    expect(result).not.toBeNull();
    expect(result?.bank).toBe('BANESCO');
    expect(result?.amount).toBe(1250.5);
    expect(result?.currency).toBe('VES');
    expect(result?.reference).toBe('984721');
    expect(result?.isBlacklisted).toBe(false);

    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'p2p:clipboard-payment-detected',
      expect.objectContaining({
        reference: '984721',
        amount: 1250.5,
      }),
    );
  });

  it('flags counterparty on blacklist match with reason', async () => {
    mockDb.findBlacklistMatches = vi.fn().mockReturnValue([
      {
        id: 1,
        identifierType: 'CEDULA',
        identifierValue: '18234567',
        fraudCategory: 'TRIANGULATION_SCAM',
        incidentNotes: 'Reportado por estafa de triangulación',
        riskLevel: 'CRITICAL',
        reportedAt: Date.now(),
      },
    ]);

    const watcher = new ClipboardWatcherService(
      mockDb as P2PDatabaseService,
      () => mockWin as unknown as BrowserWindow,
      mockReader,
    );

    clipboardText =
      'Pago Movil BDV recibido por 3.500 Bs ref: 456789 de Pedro CI: 18234567';

    const result = await watcher.pollClipboard();

    expect(result).not.toBeNull();
    expect(result?.isBlacklisted).toBe(true);
    expect(result?.blacklistReason).toBe('Reportado por estafa de triangulación');
    expect(result?.reference).toBe('456789');
  });

  it('deduplicates identical text on consecutive polling ticks', async () => {
    const watcher = new ClipboardWatcherService(
      mockDb as P2PDatabaseService,
      () => mockWin as unknown as BrowserWindow,
      mockReader,
    );

    clipboardText =
      'Banesco Pago Movil recibido 500,00 Bs Ref: 123456 22/09/2026';

    const first = await watcher.pollClipboard();
    expect(first).not.toBeNull();
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(1);

    // Second poll with same text
    const second = await watcher.pollClipboard();
    expect(second).toBeNull();
    expect(mockWin.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('ignores non-payment text (e.g. general conversation, URLs, code)', async () => {
    const watcher = new ClipboardWatcherService(
      mockDb as P2PDatabaseService,
      () => mockWin as unknown as BrowserWindow,
      mockReader,
    );

    clipboardText = 'Hola Juan, nos vemos a las 5pm en la oficina.';
    const result = await watcher.pollClipboard();
    expect(result).toBeNull();
    expect(mockWin.webContents.send).not.toHaveBeenCalled();

    clipboardText = 'const x = Math.random() * 100; console.log(x);';
    const result2 = await watcher.pollClipboard();
    expect(result2).toBeNull();
    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });

  it('respects start and stop toggle', async () => {
    const watcher = new ClipboardWatcherService(
      mockDb as P2PDatabaseService,
      () => mockWin as unknown as BrowserWindow,
      mockReader,
    );

    expect(watcher.isEnabled()).toBe(true);
    watcher.stop();
    expect(watcher.isEnabled()).toBe(false);

    clipboardText =
      'Banesco Pago Movil recibido 500,00 Bs Ref: 123456 22/09/2026';
    const result = await watcher.pollClipboard();
    expect(result).toBeNull();

    watcher.start();
    expect(watcher.isEnabled()).toBe(true);
  });
});
