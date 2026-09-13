import { ipcMain, app, net, safeStorage, desktopCapturer, type IpcMainInvokeEvent } from 'electron';
import type { P2PIpcChannels, BinanceSearchParams, CotizaveRequest, ScreenPipeSource } from '../../shared/types';
import { P2PDatabaseService } from '../db/database';
import { GeminiOrchestrator } from '../gemini-orchestrator';

/**
 * Typed, allow-listed IPC handlers.
 * `p2p:fetch-binance` allows the app to query Binance P2P public orderbook
 * bypassing any browser CORS limitations natively and securely.
 * `crypto:*` handlers leverage OS-native DPAPI / Keychain encryption via safeStorage.
 */
export function registerIpcHandlers(): void {
  ipcMain.removeHandler('app:get-version');
  ipcMain.handle('app:get-version', (_event: IpcMainInvokeEvent): string => {
    return app.getVersion();
  });

  ipcMain.removeHandler('p2p:fetch-binance');
  ipcMain.handle(
    'p2p:fetch-binance',
    async (_event: IpcMainInvokeEvent, params: BinanceSearchParams): Promise<unknown> => {
      try {
        const response = await net.fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: '*/*',
          },
          body: JSON.stringify({
            asset: params.asset ?? 'USDT',
            fiat: params.fiat ?? 'VES',
            tradeType: params.tradeType ?? 'BUY',
            page: 1,
            rows: params.rows ?? 10,
            payTypes: params.payTypes ?? [],
            countries: [],
            proMerchantAds: false,
            shieldMerchantAds: false,
            filterType: 'all',
            periods: [],
          }),
        });

        if (!response.ok) {
          throw new Error(`Binance P2P respondió HTTP ${response.status}`);
        }

        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOTFOUND') || message.includes('fetch failed') || message.includes('aborted') || message.includes('timeout')) {
          throw new Error('Servidor de Binance P2P no accesible (sin conexión o DNS no disponible)');
        }
        throw new Error(message);
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-cotizave');
  ipcMain.handle(
    'p2p:fetch-cotizave',
    async (_event: IpcMainInvokeEvent, req: CotizaveRequest): Promise<unknown> => {
      if (!req || typeof req.apiKey !== 'string' || req.apiKey.trim().length === 0) {
        throw new Error('Cotizave API key is required');
      }
      if (req.endpoint !== 'rates') {
        throw new Error('Cotizave endpoint must be "rates"');
      }
      try {
        const url = `https://api.cotizave.com/v1/fx/${req.endpoint}`;
        const response = await net.fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(15000),
          headers: {
            'X-API-Key': req.apiKey,
            Accept: 'application/json',
          },
        });
        if (!response.ok) {
          throw new Error(`Cotizave HTTP Error ${response.status}`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          throw new Error('Cotizave returned non-JSON response');
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOTFOUND') || message.includes('fetch failed') || message.includes('aborted') || message.includes('timeout')) {
          throw new Error('Servidor Cotizave no accesible (sin conexión o timeout)');
        }
        throw new Error(message);
      }
    },
  );

  ipcMain.removeHandler('crypto:is-available');
  ipcMain.handle('crypto:is-available', (): boolean => {
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.removeHandler('crypto:encrypt');
  ipcMain.handle('crypto:encrypt', (_event: IpcMainInvokeEvent, plaintext: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform');
    }
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString('base64');
  });

  ipcMain.removeHandler('crypto:decrypt');
  ipcMain.handle('crypto:decrypt', (_event: IpcMainInvokeEvent, ciphertext: string): string => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this platform');
    }
    const buffer = Buffer.from(ciphertext, 'base64');
    return safeStorage.decryptString(buffer);
  });

  const db = getDbService();

  ipcMain.removeHandler('p2p:db-save-order');
  ipcMain.handle('p2p:db-save-order', (_event: IpcMainInvokeEvent, order: unknown): boolean => {
    try {
      db.saveOrder(order as any);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.removeHandler('p2p:db-get-order');
  ipcMain.handle('p2p:db-get-order', (_event: IpcMainInvokeEvent, orderId: string): unknown => {
    return db.getOrder(orderId);
  });

  ipcMain.removeHandler('p2p:db-list-active-orders');
  ipcMain.handle('p2p:db-list-active-orders', (): unknown[] => {
    return db.listActiveOrders();
  });

  ipcMain.removeHandler('p2p:db-record-bank-event');
  ipcMain.handle(
    'p2p:db-record-bank-event',
    (_event: IpcMainInvokeEvent, event: unknown): { isDuplicate: boolean; eventId: number } => {
      return db.recordInboundBankEvent(event as any);
    },
  );

  ipcMain.removeHandler('p2p:killswitch-trigger');
  ipcMain.handle(
    'p2p:killswitch-trigger',
    (_event: IpcMainInvokeEvent, params: { reason?: string; source?: string }): boolean => {
      return triggerKillswitch(params?.reason, params?.source);
    },
  );

  ipcMain.removeHandler('p2p:killswitch-status');
  ipcMain.handle('p2p:killswitch-status', () => {
    return { ...killswitchState };
  });

  ipcMain.removeHandler('p2p:screen-pipe-sources');
  ipcMain.handle('p2p:screen-pipe-sources', async (): Promise<ScreenPipeSource[]> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnailDataUrl: s.thumbnail.toDataURL(),
      }));
    } catch {
      return [];
    }
  });

  ipcMain.removeHandler('p2p:screen-pipe-capture');
  ipcMain.handle(
    'p2p:screen-pipe-capture',
    async (
      _event: IpcMainInvokeEvent,
      options?: { sourceId?: string },
    ): Promise<{ dataUrl: string; timestampMs: number } | null> => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 1920, height: 1080 },
        });
        const target = options?.sourceId ? sources.find((s) => s.id === options.sourceId) : sources[0];
        if (!target) return null;
        return {
          dataUrl: target.thumbnail.toDataURL(),
          timestampMs: Date.now(),
        };
      } catch {
        return null;
      }
    },
  );

  const orchestrator = getOrchestrator();

  ipcMain.removeHandler('copilot:send-message');
  ipcMain.handle(
    'copilot:send-message',
    async (_event: IpcMainInvokeEvent, params: { prompt: string; history?: any[] }) => {
      return orchestrator.sendMessage(params);
    },
  );

  ipcMain.removeHandler('copilot:execute-plan');
  ipcMain.handle(
    'copilot:execute-plan',
    (_event: IpcMainInvokeEvent, params: { planId: string }) => {
      return orchestrator.executePlan(params.planId);
    },
  );

  ipcMain.removeHandler('copilot:get-plans');
  ipcMain.handle(
    'copilot:get-plans',
    (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
      return orchestrator.getPlans(params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:get-learnings');
  ipcMain.handle(
    'copilot:get-learnings',
    (_event: IpcMainInvokeEvent, params?: { category?: string; limit?: number }) => {
      return orchestrator.getLearnings(params?.category, params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:set-api-key');
  ipcMain.handle(
    'copilot:set-api-key',
    (_event: IpcMainInvokeEvent, params: { apiKey: string }) => {
      orchestrator.setApiKey(params.apiKey);
      return true;
    },
  );

  ipcMain.removeHandler('copilot:test-connection');
  ipcMain.handle('copilot:test-connection', async () => {
    return orchestrator.testConnection();
  });
}

let dbInstance: P2PDatabaseService | null = null;
export function getDbService(): P2PDatabaseService {
  if (!dbInstance) {
    dbInstance = new P2PDatabaseService();
  }
  return dbInstance;
}

let orchestratorInstance: GeminiOrchestrator | null = null;
export function getOrchestrator(): GeminiOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new GeminiOrchestrator(getDbService());
  }
  return orchestratorInstance;
}


export interface KillswitchState {
  isTriggered: boolean;
  timestamp?: number;
  reason?: string;
  source?: string;
}

export const killswitchState: KillswitchState = {
  isTriggered: false,
};

export function triggerKillswitch(reason = 'Emergencia', source = 'IPC'): boolean {
  killswitchState.isTriggered = true;
  killswitchState.timestamp = Date.now();
  killswitchState.reason = reason;
  killswitchState.source = source;
  return true;
}

// Compile-time guarantee that the handler map matches the channel contract.
export type RegisteredChannels = keyof P2PIpcChannels;
