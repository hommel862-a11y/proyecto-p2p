import type {
  ElectronAPI,
  BacktestRunResult,
  ArmWorkspaceCode,
  ArmBankRailRecord,
  ArmPaymentReceiptInput,
  ArmPaymentReceiptRecordResult,
  ArmTreasurySettlementInput,
  ArmTreasurySettlementResult,
  Finance360SnapshotPayload,
  Finance360StoredSnapshot,
  Finance360SaveSnapshotResult,
  Finance360AiAnalyzeRequest,
  Finance360AiAnalyzeResult,
  Finance360ExportPdfRequest,
  Finance360ExportPdfResult,
  BinanceDockOpenRequest,
  BinanceDockStateDto,
  BinanceVaultStatusDto,
  BinanceVaultSaveRequest,
  BinanceSyncOrdersRequest,
  BinanceSyncedC2cOrderDto,
  BinanceMerchantSapiRequest,
  BinanceMerchantSapiResult,
} from '../shared/types';
// Type-only, so it is erased at compile time and cannot pull `node:sqlite` (or any
// other main-process module) into the preload bundle. The reverse direction — the main
// process importing a type from this file — is deliberately avoided: `electron/tsconfig.json`
// includes only `main/**` and `shared/**`, so such an edge would pull this untypechecked
// file into the main program and surface its latent unrelated drift.
import type { DecisionJournalOp } from '../main/db/decision-journal.repository';

// Minimal, trusted subset of ipcRenderer the bridge is allowed to use.
export type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type IpcOn = (channel: string, listener: (...args: unknown[]) => void) => () => void;

/**
 * The journal bridge, as seen by the renderer.
 *
 * Deliberately `unknown` in both directions: the real payload and result types live in
 * `@p2p/core` and belong to the Angular service that consumes them, and the preload
 * cannot import from `projects/core` (the Electron tsconfig pins `rootDir: "."`, which
 * rejects a cross-project import with TS6059). Typing the boundary as `unknown` keeps
 * the bridge honest instead of duplicating domain types that could silently drift, and
 * the real typing is applied in exactly one place: `DecisionJournalService`.
 */
export interface DecisionJournalBridge {
  invoke: (op: DecisionJournalOp, payload?: unknown) => Promise<unknown>;
}

/** The renderer-facing API: the shared `ElectronAPI` plus the journal seam. */
export type P2PApi = ElectronAPI & { decisionJournal: DecisionJournalBridge };

/**
 * Pure, framework-free builder for the renderer-facing API.
 * Kept free of any `electron` import so it is unit-testable under Vitest
 * (no native binary required) and so the security surface is auditable.
 */
export function createP2PApi(ipc: IpcInvoke, onEvent?: IpcOn): P2PApi {
  return {
    getVersion: () => ipc('app:get-version') as Promise<string>,
    fetchBinanceP2p: (params) => ipc('p2p:fetch-binance', params) as Promise<unknown>,
    fetchBinanceSpotTicker: (symbol) =>
      ipc('p2p:fetch-binance-spot', symbol) as Promise<unknown>,
    fetchBinanceC2cOrders: (req) =>
      ipc('p2p:fetch-binance-c2c-orders', req) as Promise<unknown>,
    fetchCotizave: (req) => ipc('p2p:fetch-cotizave', req) as Promise<unknown>,
    fetchBybitP2p: (req) => ipc('p2p:fetch-bybit-p2p', req) as Promise<unknown>,
    fetchElDoradoQuote: (req) => ipc('p2p:fetch-eldorado-quote', req) as Promise<unknown>,
    // The renderer cannot spawn Node; the main process owns the harness path and
    // the argument list, so this bridge only forwards selector labels.
    backtest: {
      run: (req) => ipc('p2p:backtest-run', req) as Promise<BacktestRunResult>,
    },
    crypto: {
      isAvailable: () => ipc('crypto:is-available') as Promise<boolean>,
      encrypt: (plaintext: string) => ipc('crypto:encrypt', plaintext) as Promise<string>,
      vaultSet: (key: string, secret: string) =>
        ipc('vault:set', { key, secret }) as Promise<boolean>,
      vaultGet: (key: string) => ipc('vault:get', { key }) as Promise<string | null>,
      vaultHas: (key: string) => ipc('vault:has', { key }) as Promise<boolean>,
      vaultDelete: (key: string) => ipc('vault:delete', { key }) as Promise<boolean>,
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
      saveOperationRecord: (record: unknown) =>
        ipc('p2p:db-save-operation-record', record) as Promise<boolean>,
      listOperationRecords: (params?: any) =>
        ipc('p2p:db-list-operation-records', params) as Promise<unknown[]>,
      saveFxSettlement: (record: unknown) =>
        ipc('p2p:db-save-fx-settlement', record) as Promise<{
          saved: boolean;
          duplicate: boolean;
          prevHash: string;
          rowHash: string;
        }>,
      listFxSettlements: (params?: { limit?: number }) =>
        ipc('p2p:db-list-fx-settlements', params) as Promise<unknown[]>,
      saveBankAccount: (account: unknown) =>
        ipc('p2p:db-save-bank-account', account) as Promise<boolean>,
      getBankAccount: (id: string) =>
        ipc('p2p:db-get-bank-account', id) as Promise<unknown>,
      listBankAccounts: (filter?: unknown) =>
        ipc('p2p:db-list-bank-accounts', filter) as Promise<unknown[]>,
      deleteBankAccount: (id: string) =>
        ipc('p2p:db-delete-bank-account', id) as Promise<boolean>,
      listMarketSnapshots: (filter?: unknown) =>
        ipc('p2p:db-list-market-snapshots', filter) as Promise<unknown[]>,
    },
    // The single decision-journal entry point. No raw channel reaches the renderer and
    // the payload is opaque here; `DecisionJournalService` applies the real domain types.
    // The wire shape is uniformly `{ op, payload }` so the main process can switch on
    // `op` and narrow `payload` in one place, instead of the renderer hand-building a
    // differently-shaped object per operation.
    decisionJournal: {
      invoke: (op, payload) => ipc('p2p:db-decision-journal', { op, payload }) as Promise<unknown>,
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
    // Publishes the renderer's real treasury state. Bank accounts never leave localStorage,
    // so this announcement is the only way the main process learns the real daily limits.
    announceTreasury: (snapshot) => ipc('p2p:treasury-announce', snapshot) as Promise<boolean>,
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
      setProviderConfig: (params: { provider: string; model?: string; apiKey?: string }) =>
        ipc('copilot:set-provider-config', params) as Promise<any>,
      getProviderConfig: () => ipc('copilot:get-provider-config') as Promise<any>,
      testConnection: (params?: { provider?: string; apiKey?: string; model?: string }) =>
        ipc('copilot:test-connection', params) as Promise<any>,
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
      listAgents: () => ipc('copilot:list-agents') as Promise<any>,
      toggleAgent: (params: { id: string; enabled: boolean }) =>
        ipc('copilot:toggle-agent', params) as Promise<boolean>,
      saveAgent: (params: { agent: any }) =>
        ipc('copilot:save-agent', params) as Promise<boolean>,
      cancelTurn: (params: { requestId?: string }) =>
        ipc('copilot:cancel-turn', params) as Promise<{ cancelled: boolean }>,
      listThreads: (params?: { limit?: number }) =>
        ipc('copilot:list-threads', params) as Promise<any[]>,
      createThread: (params?: { title?: string; agentId?: string }) =>
        ipc('copilot:create-thread', params) as Promise<any>,
      getThreadMessages: (params: { threadId: string; limit?: number }) =>
        ipc('copilot:get-thread-messages', params) as Promise<any[]>,
      deleteThread: (params: { threadId: string }) =>
        ipc('copilot:delete-thread', params) as Promise<boolean>,
      rejectPlan: (params: { planId: string; reason?: string }) =>
        ipc('copilot:reject-plan', params) as Promise<{ success: boolean }>,
      reviewEngramObservation: (params: { id: number; action: 'approve' | 'discard' }) =>
        ipc('copilot:review-engram', params) as Promise<any>,
      getUsageSummary: (params?: { windowHours?: number }) =>
        ipc('copilot:get-usage-summary', params) as Promise<any>,
      onAlphaOpportunity: (callback: (data: any) => void) => {
        if (!onEvent) return () => {};
        return onEvent('copilot:alpha-opportunity-detected', (payload) => callback(payload));
      },
      onProactiveAlert: (callback: (payload: unknown) => void) => {
        if (!onEvent) return () => {};
        return onEvent('copilot:proactive-event-alert', (payload) => callback(payload));
      },
      onStreamEvent: (callback: (event: any) => void) => {
        if (!onEvent) return () => {};
        return onEvent('copilot:stream-event', (payload) => callback(payload));
      },
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
    agents: {
      list: (filter) => ipc('agents:list', filter) as Promise<any>,
      get: (id) => ipc('agents:get', id) as Promise<any>,
      create: (dto) => ipc('agents:create', dto) as Promise<any>,
      update: (id, dto) => ipc('agents:update', { id, dto }) as Promise<any>,
      delete: (id) => ipc('agents:delete', id) as Promise<boolean>,
      toggle: (id, active) => ipc('agents:toggle', { id, active }) as Promise<any>,
      runSandbox: (params) => ipc('agents:run-sandbox', params) as Promise<any>,
      runNow: (params) => ipc('agents:run-now', params) as Promise<any>,
      listRuns: (filter) => ipc('agents:list-runs', filter) as Promise<any>,
      getFleetMetrics: () => ipc('agents:get-fleet-metrics') as Promise<any>,
      getDaemonStatus: () => ipc('agents:get-daemon-status') as Promise<any>,
      onRunEvent: (callback: (payload: any) => void) => {
        if (!onEvent) return () => {};
        return onEvent('agents:run-event', (payload) => callback(payload));
      },
    },
    telegram: {
      downloadFile: (params: { token: string; filePath: string }) =>
        ipc('p2p:telegram-download-file', params) as Promise<{
          success: boolean;
          base64: string;
          mimeType: string;
        }>,
    },
    arm: {
      listLeads: (workspaceId) => ipc('arm:list-leads', workspaceId) as Promise<unknown[]>,
      upsertLead: (lead) => ipc('arm:upsert-lead', lead) as Promise<unknown>,
      listPendingApprovals: (workspaceId) =>
        ipc('arm:list-approvals', workspaceId) as Promise<unknown[]>,
      saveApproval: (item) => ipc('arm:save-approval', item) as Promise<unknown>,
      resolveApproval: (params) => ipc('arm:resolve-approval', params) as Promise<unknown>,
      listShadowExamples: (params) =>
        ipc('arm:list-shadow-examples', params) as Promise<unknown[]>,
      appendOutboxEvent: (params) => ipc('arm:append-outbox', params) as Promise<unknown>,
      listOutboxSince: (params) => ipc('arm:list-outbox', params) as Promise<unknown[]>,
      upsertBankRail: (rail: ArmBankRailRecord) =>
        ipc('arm:upsert-bank-rail', rail) as Promise<ArmBankRailRecord>,
      listBankRails: (workspaceId: ArmWorkspaceCode) =>
        ipc('arm:list-bank-rails', workspaceId) as Promise<ArmBankRailRecord[]>,
      recordPaymentReceipt: (receipt: ArmPaymentReceiptInput) =>
        ipc('arm:record-payment-receipt', receipt) as Promise<ArmPaymentReceiptRecordResult>,
      recordTreasurySettlement: (settlement: ArmTreasurySettlementInput) =>
        ipc('arm:record-treasury-settlement', settlement) as Promise<ArmTreasurySettlementResult>,
      getGatewayConfig: () =>
        ipc('arm:get-gateway-config') as Promise<{ url: string; authToken: string }>,
    },
    finance360: {
      getSnapshot: () => ipc('f360:get-snapshot') as Promise<Finance360StoredSnapshot | null>,
      saveSnapshot: (snapshot: Finance360SnapshotPayload) =>
        ipc('f360:save-snapshot', snapshot) as Promise<Finance360SaveSnapshotResult>,
      aiAnalyze: (request: Finance360AiAnalyzeRequest) =>
        ipc('f360:ai-analyze', request) as Promise<Finance360AiAnalyzeResult>,
      exportPdf: (request: Finance360ExportPdfRequest) =>
        ipc('f360:export-pdf', request) as Promise<Finance360ExportPdfResult>,
    },
    binanceDock: {
      open: (req: BinanceDockOpenRequest) =>
        ipc('p2p:dock-open', req) as Promise<BinanceDockStateDto>,
      close: () => ipc('p2p:dock-close') as Promise<BinanceDockStateDto>,
      toggle: (req?: BinanceDockOpenRequest) =>
        ipc('p2p:dock-toggle', req) as Promise<BinanceDockStateDto>,
      getState: () => ipc('p2p:dock-state') as Promise<BinanceDockStateDto>,
      openExternal: (url: string) =>
        ipc('p2p:open-external', url) as Promise<{ opened: boolean }>,
      onStateChanged: (listener: (state: BinanceDockStateDto) => void) => {
        if (!onEvent) return () => {};
        return onEvent('p2p:dock-state-changed', (payload) =>
          listener(payload as BinanceDockStateDto),
        );
      },
    },
    binanceVault: {
      getStatus: () => ipc('p2p:binance-config-get') as Promise<BinanceVaultStatusDto>,
      saveConfig: (req: BinanceVaultSaveRequest) =>
        ipc('p2p:binance-config-save', req) as Promise<BinanceVaultStatusDto>,
      clearConfig: () => ipc('p2p:binance-config-clear') as Promise<BinanceVaultStatusDto>,
      syncOrders: (req?: BinanceSyncOrdersRequest) =>
        ipc('p2p:binance-sync-orders', req) as Promise<BinanceSyncedC2cOrderDto[]>,
      invokeMerchantSapi: (req: BinanceMerchantSapiRequest) =>
        ipc('p2p:binance-merchant-sapi', req) as Promise<BinanceMerchantSapiResult>,
    },
  };
}

// Single source of truth for the exact method names the bridge exposes.
// Used by both the preload guard and the test to prove the surface is narrow.
export const EXPOSED_API_KEYS = [
  'getVersion',
  'fetchBinanceP2p',
  'fetchBinanceSpotTicker',
  'fetchBinanceC2cOrders',
  'fetchCotizave',
  'fetchBybitP2p',
  'fetchElDoradoQuote',
  'backtest',
  'crypto',
  'db',
  'decisionJournal',
  'killswitch',
  'announceTreasury',
  'copilot',
  'screenPipe',
  'mcp',
  'clipboard',
  'agents',
  'telegram',
  'arm',
  'finance360',
  'binanceDock',
  'binanceVault',
] as const;

// The channels the bridge is permitted to forward. Anything else must be
// rejected so no arbitrary channel ever crosses the boundary.
export const ALLOWED_CHANNELS = [
  'app:get-version',
  'p2p:fetch-binance',
  'p2p:fetch-binance-spot',
  'p2p:fetch-binance-c2c-orders',
  'p2p:fetch-cotizave',
  'p2p:fetch-bybit-p2p',
  'p2p:fetch-eldorado-quote',
  'p2p:backtest-run',
  'crypto:is-available',
  'crypto:encrypt',
  'vault:set',
  'vault:get',
  'vault:has',
  'vault:delete',
  'p2p:db-save-order',
  'p2p:db-get-order',
  'p2p:db-list-active-orders',
  'p2p:db-record-bank-event',
  'p2p:db-save-audit-log',
  'p2p:db-list-audit-logs',
  'p2p:db-save-operation-record',
  'p2p:db-list-operation-records',
  'p2p:db-save-fx-settlement',
  'p2p:db-list-fx-settlements',
  'p2p:db-save-bank-account',
  'p2p:db-get-bank-account',
  'p2p:db-list-bank-accounts',
  'p2p:db-delete-bank-account',
  'p2p:db-list-market-snapshots',
  'p2p:db-decision-journal',
  'p2p:killswitch-trigger',
  'p2p:killswitch-status',
  'p2p:treasury-announce',
  'copilot:send-message',
  'copilot:transcribe-audio',
  'copilot:execute-plan',
  'copilot:get-plans',
  'copilot:get-learnings',
  'copilot:get-engram-observations',
  'copilot:set-api-key',
  'copilot:set-provider-config',
  'copilot:get-provider-config',
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
  'copilot:list-agents',
  'copilot:toggle-agent',
  'copilot:save-agent',
  'copilot:cancel-turn',
  'copilot:list-threads',
  'copilot:create-thread',
  'copilot:get-thread-messages',
  'copilot:delete-thread',
  'copilot:reject-plan',
  'copilot:review-engram',
  'copilot:get-usage-summary',
  'p2p:screen-pipe-sources',
  'p2p:screen-pipe-capture',
  'p2p:mcp-status',
  'p2p:mcp-test-tool',
  'p2p:clipboard-watcher-toggle',
  'p2p:clipboard-watcher-status',
  'agents:list',
  'agents:get',
  'agents:create',
  'agents:update',
  'agents:delete',
  'agents:toggle',
  'agents:run-sandbox',
  'agents:run-now',
  'agents:list-runs',
  'agents:get-fleet-metrics',
  'agents:get-daemon-status',
  'p2p:telegram-download-file',
  'arm:list-leads',
  'arm:upsert-lead',
  'arm:list-approvals',
  'arm:save-approval',
  'arm:resolve-approval',
  'arm:list-shadow-examples',
  'arm:append-outbox',
  'arm:list-outbox',
  'arm:upsert-bank-rail',
  'arm:list-bank-rails',
  'arm:record-payment-receipt',
  'arm:record-treasury-settlement',
  'arm:get-gateway-config',
  'f360:get-snapshot',
  'f360:save-snapshot',
  'f360:ai-analyze',
  'f360:export-pdf',
  'p2p:dock-open',
  'p2p:dock-close',
  'p2p:dock-toggle',
  'p2p:dock-state',
  'p2p:open-external',
  'p2p:binance-config-get',
  'p2p:binance-config-save',
  'p2p:binance-config-clear',
  'p2p:binance-sync-orders',
  'p2p:binance-merchant-sapi',
] as const;

// Allow-listed server-to-renderer push event channels
export const ALLOWED_LISTEN_CHANNELS = [
  'p2p:clipboard-payment-detected',
  'copilot:alpha-opportunity-detected',
  'copilot:proactive-event-alert',
  'copilot:stream-event',
  'p2p:killswitch-triggered',
  'agents:run-event',
  'p2p:dock-state-changed',
] as const;
