import type { ElectronAPI } from '../shared/types';

// Minimal, trusted subset of ipcRenderer the bridge is allowed to use.
export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type IpcOn = (channel: string, listener: (...args: unknown[]) => void) => () => void;

/**
 * Pure, framework-free builder for the renderer-facing API.
 * Kept free of any `electron` import so it is unit-testable under Vitest
 * (no native binary required) and so the security surface is auditable.
 */
export function createP2PApi(ipc: IpcInvoke, onEvent?: IpcOn): ElectronAPI {
  return {
    getVersion: () => ipc('app:get-version') as Promise<string>,
    fetchBinanceP2p: (params) => ipc('p2p:fetch-binance', params) as Promise<unknown>,
    fetchCotizave: (req) => ipc('p2p:fetch-cotizave', req) as Promise<unknown>,
    fetchBybitP2p: (req) => ipc('p2p:fetch-bybit-p2p', req) as Promise<unknown>,
    fetchElDoradoQuote: (req) => ipc('p2p:fetch-eldorado-quote', req) as Promise<unknown>,
    crypto: {
      isAvailable: () => ipc('crypto:is-available') as Promise<boolean>,
      encrypt: (plaintext: string) => ipc('crypto:encrypt', plaintext) as Promise<string>,
      decrypt: (ciphertext: string) => ipc('crypto:decrypt', ciphertext) as Promise<string>,
    },
    db: {
      saveOrder: (order: unknown) => ipc('p2p:db-save-order', order) as Promise<boolean>,
      getOrder: (orderId: string) => ipc('p2p:db-get-order', orderId) as Promise<unknown>,
      listActiveOrders: () => ipc('p2p:db-list-active-orders') as Promise<unknown[]>,
      recordBankEvent: (event: unknown) =>
        ipc('p2p:db-record-bank-event', event) as Promise<{
          isDuplicate: boolean;
          eventId: number;
        }>,
      saveAuditLog: (record: any) => ipc('p2p:db-save-audit-log', record) as Promise<boolean>,
      listAuditLogs: (params?: any) => ipc('p2p:db-list-audit-logs', params) as Promise<unknown[]>,
      saveOperationRecord: (record: any) =>
        ipc('p2p:db-save-operation-record', record) as Promise<boolean>,
      listOperationRecords: (params?: any) =>
        ipc('p2p:db-list-operation-records', params) as Promise<unknown[]>,
    },
    killswitch: {
      trigger: (params?: { reason?: string; source?: string }) =>
        ipc('p2p:killswitch-trigger', params ?? {}) as Promise<boolean>,
      getStatus: () =>
        ipc('p2p:killswitch-status') as Promise<{
          isTriggered: boolean;
          timestamp?: number;
          reason?: string;
          source?: string;
        }>,
    },
    copilot: {
      sendMessage: (params) => ipc('copilot:send-message', params) as Promise<any>,
      transcribeAudio: (params: { audioBase64: string; mimeType: string }) =>
        ipc('copilot:transcribe-audio', params) as Promise<{ text: string; error?: string }>,
      executePlan: (params) => ipc('copilot:execute-plan', params) as Promise<any>,
      getPlans: (params) => ipc('copilot:get-plans', params) as Promise<any>,
      getLearnings: (params) => ipc('copilot:get-learnings', params) as Promise<any>,
      getEngramObservations: (params) =>
        ipc('copilot:get-engram-observations', params) as Promise<any>,
      setApiKey: (params) => ipc('copilot:set-api-key', params) as Promise<any>,
      testConnection: () => ipc('copilot:test-connection') as Promise<any>,
      getWatcherStatus: () => ipc('copilot:get-watcher-status') as Promise<any>,
      setWatcherConfig: (params) => ipc('copilot:set-watcher-config', params) as Promise<any>,
      runSwarmAnalysis: (params) => ipc('copilot:run-swarm-analysis', params) as Promise<any>,
      getSwarmHealth: () => ipc('copilot:get-swarm-health') as Promise<any>,
      auditDisputeProof: (params) => ipc('copilot:audit-dispute-proof', params) as Promise<any>,
      triggerProactiveEval: (params) =>
        ipc('copilot:trigger-proactive-eval', params) as Promise<any>,
      assessCounterparty: (params) => ipc('copilot:assess-counterparty', params) as Promise<any>,
      recordCounterpartyTrade: (params) =>
        ipc('copilot:record-counterparty-trade', params) as Promise<any>,
      listCounterparties: (params) => ipc('copilot:list-counterparties', params) as Promise<any>,
      runMonteCarlo: (params) => ipc('copilot:run-monte-carlo', params) as Promise<any>,
    },
    screenPipe: {
      getSources: () => ipc('p2p:screen-pipe-sources') as Promise<any>,
      capture: (sourceId?: string) => ipc('p2p:screen-pipe-capture', { sourceId }) as Promise<any>,
    },
    mcp: {
      getStatus: () => ipc('p2p:mcp-status') as Promise<any>,
      testTool: (toolName: string, args: unknown) =>
        ipc('p2p:mcp-test-tool', { toolName, args }) as Promise<any>,
    },
    clipboard: {
      toggleWatcher: (enabled: boolean) =>
        ipc('p2p:clipboard-watcher-toggle', { enabled }) as Promise<boolean>,
      getWatcherStatus: () =>
        ipc('p2p:clipboard-watcher-status') as Promise<{
          enabled: boolean;
          pollIntervalMs: number;
          lastDetectedReference?: string;
        }>,
      onPaymentDetected: (callback: (payload: any) => void) => {
        if (!onEvent) return () => {};
        return onEvent('p2p:clipboard-payment-detected', (payload) => callback(payload));
      },
    },
  };
}

// Single source of truth for the exact method names the bridge exposes.
// Used by both the preload guard and the test to prove the surface is narrow.
export const EXPOSED_API_KEYS = [
  'getVersion',
  'fetchBinanceP2p',
  'fetchCotizave',
  'fetchBybitP2p',
  'fetchElDoradoQuote',
  'crypto',
  'db',
  'killswitch',
  'copilot',
  'screenPipe',
  'mcp',
  'clipboard',
] as const;

// The channels the bridge is permitted to forward. Anything else must be
// rejected so no arbitrary channel ever crosses the boundary.
export const ALLOWED_CHANNELS = [
  'app:get-version',
  'p2p:fetch-binance',
  'p2p:fetch-cotizave',
  'p2p:fetch-bybit-p2p',
  'p2p:fetch-eldorado-quote',
  'crypto:is-available',
  'crypto:encrypt',
  'crypto:decrypt',
  'p2p:db-save-order',
  'p2p:db-get-order',
  'p2p:db-list-active-orders',
  'p2p:db-record-bank-event',
  'p2p:killswitch-trigger',
  'p2p:killswitch-status',
  'copilot:send-message',
  'copilot:transcribe-audio',
  'copilot:execute-plan',
  'copilot:get-plans',
  'copilot:get-learnings',
  'copilot:get-engram-observations',
  'copilot:set-api-key',
  'copilot:test-connection',
  'copilot:get-watcher-status',
  'copilot:set-watcher-config',
  'copilot:run-swarm-analysis',
  'copilot:get-swarm-health',
  'copilot:audit-dispute-proof',
  'copilot:trigger-proactive-eval',
  'copilot:assess-counterparty',
  'copilot:record-counterparty-trade',
  'copilot:list-counterparties',
  'copilot:run-monte-carlo',
  'p2p:screen-pipe-sources',
  'p2p:screen-pipe-capture',
  'p2p:mcp-status',
  'p2p:mcp-test-tool',
  'p2p:clipboard-watcher-toggle',
  'p2p:clipboard-watcher-status',
] as const;

// Allow-listed server-to-renderer push event channels
export const ALLOWED_LISTEN_CHANNELS = [
  'p2p:clipboard-payment-detected',
  'copilot:alpha-opportunity-detected',
  'p2p:killswitch-triggered',
] as const;
