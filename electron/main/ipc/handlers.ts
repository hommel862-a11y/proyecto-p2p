import { ipcMain, app, net, safeStorage, desktopCapturer, type IpcMainInvokeEvent } from 'electron';
import { createHmac } from 'crypto';
import type {
  P2PIpcChannels,
  BinanceSearchParams,
  CotizaveRequest,
  BybitP2pFetchRequest,
  ElDoradoQuoteRequest,
  ScreenPipeSource,
  AlphaWatcherConfigDto,
} from '../../shared/types';
import { P2PDatabaseService } from '../db/database';
import { GeminiOrchestrator } from '../gemini-orchestrator';
import { AgentSwarmOrchestrator } from '../agents/swarm-orchestrator';
import {
  MonteCarloSimulator,
  type MonteCarloSimulationConfig,
} from '../agents/monte-carlo-simulator';
import { getMcpFullStatus, executeMcpToolTest } from '../mcp-bootstrap';
import { AlphaWatcher } from '../alpha-watcher';
import { ClipboardWatcherService } from '../services/clipboard-watcher';

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
        const response = await net.fetch(
          'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
          {
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
          },
        );

        if (!response.ok) {
          throw new Error(`Binance P2P respondió HTTP ${response.status}`);
        }

        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error(
            'Servidor de Binance P2P no accesible (sin conexión o DNS no disponible)',
            { cause: err },
          );
        }
        throw new Error(message, { cause: err });
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
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor Cotizave no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-bybit-p2p');
  ipcMain.handle(
    'p2p:fetch-bybit-p2p',
    async (_event: IpcMainInvokeEvent, req: BybitP2pFetchRequest): Promise<unknown> => {
      if (
        !req ||
        typeof req.apiKey !== 'string' ||
        req.apiKey.trim().length === 0 ||
        typeof req.apiSecret !== 'string' ||
        req.apiSecret.trim().length === 0
      ) {
        throw new Error('Bybit P2P API key and secret are required');
      }
      if (req.side !== 0 && req.side !== 1) {
        throw new Error('Bybit P2P side must be 0 (BUY) or 1 (SELL)');
      }

      const tokenId = req.tokenId ?? 'USDT';
      const currencyId = req.currencyId ?? 'VES';
      const page = req.page ?? 1;
      const size = req.size ?? 5;
      const body = JSON.stringify({ tokenId, currencyId, side: req.side, page, size });
      const timestamp = Date.now().toString();
      const recvWindow = '20000';
      const sign = createHmac('sha256', req.apiSecret.trim())
        .update(`${timestamp}${req.apiKey.trim()}${recvWindow}${body}`)
        .digest('hex');

      try {
        const response = await net.fetch('https://api.bybit.com/v5/p2p/item/online', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'X-BAPI-API-KEY': req.apiKey.trim(),
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': recvWindow,
            'X-BAPI-SIGN': sign,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
        });
        if (!response.ok) {
          throw new Error(`Bybit P2P HTTP Error ${response.status}`);
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor Bybit P2P no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
      }
    },
  );

  ipcMain.removeHandler('p2p:fetch-eldorado-quote');
  ipcMain.handle(
    'p2p:fetch-eldorado-quote',
    async (_event: IpcMainInvokeEvent, req: ElDoradoQuoteRequest): Promise<unknown> => {
      if (
        !req ||
        typeof req.clientId !== 'string' ||
        req.clientId.trim().length === 0 ||
        typeof req.referralId !== 'string' ||
        req.referralId.trim().length === 0
      ) {
        throw new Error('El Dorado clientId and referralId are required');
      }
      if (req.direction !== 'buy' && req.direction !== 'sell') {
        throw new Error('El Dorado direction must be "buy" or "sell"');
      }

      const headers: Record<string, string> = {
        'X-Client-ID': req.clientId.trim(),
        'X-Referral-ID': req.referralId.trim(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (req.apiKey && req.apiKey.trim().length > 0) {
        headers['Authorization'] = `Bearer ${req.apiKey.trim()}`;
      }

      const body = {
        crypto: req.asset ?? 'USDT',
        legalTender: req.fiat ?? 'USD',
        ...(typeof req.amount === 'number' && req.amount > 0 ? { amount: req.amount } : {}),
        ...(req.paymentMethod && req.paymentMethod.trim().length > 0
          ? { payment_method: req.paymentMethod.trim() }
          : {}),
      };

      try {
        const response = await net.fetch(`https://api.eldorado.io/api/quote/${req.direction}`, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`El Dorado HTTP Error ${response.status}`);
        }
        return await response.json();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes('ENOTFOUND') ||
          message.includes('fetch failed') ||
          message.includes('aborted') ||
          message.includes('timeout')
        ) {
          throw new Error('Servidor El Dorado no accesible (sin conexión o timeout)', {
            cause: err,
          });
        }
        throw new Error(message, { cause: err });
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

  ipcMain.removeHandler('p2p:db-save-audit-log');
  ipcMain.handle('p2p:db-save-audit-log', (_event: IpcMainInvokeEvent, record: any): boolean => {
    try {
      return db.recordAuditLog(record);
    } catch (err) {
      console.warn('[IPC] Error in p2p:db-save-audit-log:', err);
      return false;
    }
  });

  ipcMain.removeHandler('p2p:db-list-audit-logs');
  ipcMain.handle(
    'p2p:db-list-audit-logs',
    (_event: IpcMainInvokeEvent, params?: { limit?: number; category?: string }): unknown[] => {
      try {
        return db.listAuditLogs(params?.limit, params?.category);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-audit-logs:', err);
        return [];
      }
    },
  );

  ipcMain.removeHandler('p2p:db-save-operation-record');
  ipcMain.handle(
    'p2p:db-save-operation-record',
    (_event: IpcMainInvokeEvent, record: any): boolean => {
      try {
        return db.saveOperationRecord(record);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-save-operation-record:', err);
        return false;
      }
    },
  );

  ipcMain.removeHandler('p2p:db-list-operation-records');
  ipcMain.handle(
    'p2p:db-list-operation-records',
    (_event: IpcMainInvokeEvent, params?: { limit?: number }): unknown[] => {
      try {
        return db.listOperationRecords(params?.limit);
      } catch (err) {
        console.warn('[IPC] Error in p2p:db-list-operation-records:', err);
        return [];
      }
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
        const target = options?.sourceId
          ? sources.find((s) => s.id === options.sourceId)
          : sources[0];
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

  ipcMain.removeHandler('copilot:transcribe-audio');
  ipcMain.handle(
    'copilot:transcribe-audio',
    async (_event: IpcMainInvokeEvent, params: { audioBase64: string; mimeType: string }) => {
      return orchestrator.transcribeAudio(params);
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
  ipcMain.handle('copilot:get-plans', (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
    return orchestrator.getPlans(params?.limit);
  });

  ipcMain.removeHandler('copilot:get-learnings');
  ipcMain.handle(
    'copilot:get-learnings',
    (_event: IpcMainInvokeEvent, params?: { category?: string; limit?: number }) => {
      return orchestrator.getLearnings(params?.category, params?.limit);
    },
  );

  ipcMain.removeHandler('copilot:get-engram-observations');
  ipcMain.handle(
    'copilot:get-engram-observations',
    (
      _event: IpcMainInvokeEvent,
      params?: { filter?: { topicKey?: string; type?: string; status?: string }; limit?: number },
    ) => {
      return orchestrator.getEngramObservations(params?.filter, params?.limit);
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

  ipcMain.removeHandler('copilot:get-watcher-status');
  ipcMain.handle('copilot:get-watcher-status', async () => {
    const watcher = getAlphaWatcher();
    return watcher.getStatus();
  });

  ipcMain.removeHandler('copilot:set-watcher-config');
  ipcMain.handle(
    'copilot:set-watcher-config',
    async (_event: IpcMainInvokeEvent, params: Partial<AlphaWatcherConfigDto>) => {
      const watcher = getAlphaWatcher();
      watcher.setConfig(params);
      return true;
    },
  );

  ipcMain.removeHandler('copilot:run-swarm-analysis');
  ipcMain.handle('copilot:run-swarm-analysis', async (_event: IpcMainInvokeEvent, params?: any) => {
    const swarm = getAgentSwarm();
    return swarm.runAnalysisPipeline(params);
  });

  ipcMain.removeHandler('copilot:get-swarm-health');
  ipcMain.handle('copilot:get-swarm-health', async () => {
    const swarm = getAgentSwarm();
    return swarm.getSwarmHealth();
  });

  ipcMain.removeHandler('copilot:audit-dispute-proof');
  ipcMain.handle('copilot:audit-dispute-proof', async (_event: IpcMainInvokeEvent, params: any) => {
    const swarm = getAgentSwarm();
    return swarm.auditPaymentProof(params);
  });

  ipcMain.removeHandler('copilot:trigger-proactive-eval');
  ipcMain.handle(
    'copilot:trigger-proactive-eval',
    async (
      _event: IpcMainInvokeEvent,
      params?: { parallelRate?: number; bcvRate?: number; spotUsdt?: number },
    ) => {
      const watcher = getAlphaWatcher();
      const engine = watcher.getProactiveEngine();
      const parallel = params?.parallelRate ?? 78.5;
      const bcv = params?.bcvRate ?? 65.5;
      const spot = params?.spotUsdt ?? 1.0;

      const macroAlert = engine.evaluateBcvMacroEvent(parallel, bcv);
      const depegAlert = engine.evaluateUsdtDepegEvent(spot);

      return {
        macroAlert,
        depegAlert,
      };
    },
  );

  ipcMain.removeHandler('copilot:assess-counterparty');
  ipcMain.handle(
    'copilot:assess-counterparty',
    async (
      _event: IpcMainInvokeEvent,
      params: { alias: string; realName: string; documentId?: string; bankPayerName?: string },
    ) => {
      const swarm = getAgentSwarm();
      return swarm.getCounterpartyGraph().assessRisk(params);
    },
  );

  ipcMain.removeHandler('copilot:record-counterparty-trade');
  ipcMain.handle(
    'copilot:record-counterparty-trade',
    async (
      _event: IpcMainInvokeEvent,
      params: {
        alias: string;
        realName: string;
        documentId: string;
        volumeUsdt: number;
        bankPayerName: string;
        hadTriangulationAttempt: boolean;
      },
    ) => {
      const swarm = getAgentSwarm();
      swarm.getCounterpartyGraph().recordTrade(params);
      return { success: true };
    },
  );

  ipcMain.removeHandler('copilot:list-counterparties');
  ipcMain.handle(
    'copilot:list-counterparties',
    async (_event: IpcMainInvokeEvent, params?: { limit?: number }) => {
      const swarm = getAgentSwarm();
      return swarm.getCounterpartyGraph().listProfiles(params?.limit ?? 50);
    },
  );

  ipcMain.removeHandler('copilot:run-monte-carlo');
  ipcMain.handle(
    'copilot:run-monte-carlo',
    async (
      _event: IpcMainInvokeEvent,
      params: { offers: any[]; config: MonteCarloSimulationConfig },
    ) => {
      const sim = new MonteCarloSimulator();
      return sim.runSimulation(
        params?.offers ?? [],
        params?.config ?? {
          iterations: 500,
          cancellationProbabilityPct: 15,
          priceDriftVolatilityBps: 30,
          ticketAmountUsdt: 1000,
          side: 'BUY',
        },
      );
    },
  );

  ipcMain.removeHandler('p2p:mcp-status');
  ipcMain.handle('p2p:mcp-status', async () => {
    return getMcpFullStatus();
  });

  ipcMain.removeHandler('p2p:mcp-test-tool');
  ipcMain.handle(
    'p2p:mcp-test-tool',
    async (_event: IpcMainInvokeEvent, params: { toolName: string; args: unknown }) => {
      return executeMcpToolTest(params.toolName, params.args);
    },
  );

  ipcMain.removeHandler('p2p:clipboard-watcher-toggle');
  ipcMain.handle(
    'p2p:clipboard-watcher-toggle',
    async (_event: IpcMainInvokeEvent, params: { enabled: boolean }): Promise<boolean> => {
      const watcher = getClipboardWatcher();
      if (params.enabled) {
        watcher.start();
      } else {
        watcher.stop();
      }
      return watcher.isEnabled();
    },
  );

  ipcMain.removeHandler('p2p:clipboard-watcher-status');
  ipcMain.handle('p2p:clipboard-watcher-status', async () => {
    return getClipboardWatcher().getStatus();
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
    orchestratorInstance = new GeminiOrchestrator(getDbService(), undefined, getAgentSwarm());
  }
  return orchestratorInstance;
}

let alphaWatcherInstance: AlphaWatcher | null = null;
export function setAlphaWatcher(watcher: AlphaWatcher): void {
  alphaWatcherInstance = watcher;
}

export function getAlphaWatcher(): AlphaWatcher {
  if (!alphaWatcherInstance) {
    alphaWatcherInstance = new AlphaWatcher(getDbService(), () => null);
  }
  return alphaWatcherInstance;
}

let clipboardWatcherInstance: ClipboardWatcherService | null = null;
export function setClipboardWatcher(watcher: ClipboardWatcherService): void {
  clipboardWatcherInstance = watcher;
}

export function getClipboardWatcher(): ClipboardWatcherService {
  if (!clipboardWatcherInstance) {
    clipboardWatcherInstance = new ClipboardWatcherService(getDbService(), () => null);
  }
  return clipboardWatcherInstance;
}

let agentSwarmInstance: AgentSwarmOrchestrator | null = null;
export function getAgentSwarm(): AgentSwarmOrchestrator {
  if (!agentSwarmInstance) {
    agentSwarmInstance = new AgentSwarmOrchestrator(getDbService());
  }
  return agentSwarmInstance;
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
