// Typed IPC contract for the P2P Decision Tool Electron shell (design #301, D3).
// The renderer may ONLY invoke these allow-listed channels through the preload bridge.
// All domain math stays in @p2p/core and runs inside the web bundle — NOT over IPC.

export interface BinanceSearchParams {
  asset: string;
  fiat: string;
  tradeType: 'BUY' | 'SELL';
  payTypes?: string[];
  rows?: number;
  transAmount?: number;
  publisherType?: 'merchant' | null;
}

export interface BinanceC2cOrdersFetchRequest {
  apiKey: string;
  apiSecret: string;
  tradeType: 'BUY' | 'SELL';
  page?: number;
  rows?: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

export interface CotizaveRequest {
  apiKey: string;
  endpoint: 'rates';
}

export interface BybitP2pFetchRequest {
  apiKey: string;
  apiSecret: string;
  tokenId?: string;
  currencyId?: string;
  /** 0 = BUY ads (bids), 1 = SELL ads (asks). */
  side: 0 | 1;
  page?: number;
  size?: number;
}

export interface ElDoradoQuoteRequest {
  clientId: string;
  referralId: string;
  apiKey?: string;
  direction: 'buy' | 'sell';
  asset?: string;
  fiat?: string;
  amount?: number;
  paymentMethod?: string;
}

export type P2POrderState =
  | 'ORDER_DETECTED'
  | 'PAYMENT_PENDING'
  | 'BANK_EVENT_RECEIVED'
  | 'IDENTITY_VERIFIED'
  | 'SUSPECTED_TRIANGULATION'
  | 'AWAITING_RELEASE'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface InboundBankDetails {
  bank: string;
  reference: string;
  payerName?: string;
  payerIdDoc?: string;
  amountFiat: number;
  timestamp: number;
}

export interface FsmAuditRecord {
  fromState: P2POrderState;
  toState: P2POrderState;
  event: string;
  timestamp: number;
  reason?: string;
}

export interface FsmOrderContext {
  orderId: string;
  side: 'BUY' | 'SELL';
  asset: string;
  fiat: string;
  amountCrypto: number;
  amountFiat: number;
  price: number;
  counterpartyName: string;
  counterpartyIdDoc?: string;
  currentState: P2POrderState;
  bankPayment?: InboundBankDetails;
  fraudScore?: number;
  flags: string[];
  history: FsmAuditRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface ScreenPipeSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
}

export interface ClipboardPaymentPayload {
  bank: string;
  bankDisplayName: string;
  reference: string;
  amount: number;
  currency: 'VES' | 'COP' | 'USD' | 'USDT' | 'EUR';
  payerName?: string;
  payerId?: string;
  beneficiaryPhone?: string;
  timestamp: number;
  rawText: string;
  confidenceScore: number;
  isBlacklisted?: boolean;
  blacklistReason?: string;
}

/**
 * Selector labels for a backtest run. Both are advisory: the harness reads its
 * own local dataset and accepts no pair/timeframe on its CLI.
 */
export interface BacktestRunRequest {
  pair?: string;
  timeframe?: string;
}

/** Outcome of one harness run, including the parsed JSON summary when available. */
export interface BacktestRunResult {
  ok: boolean;
  /** Harness stdout, trimmed to a bounded length. */
  stdout?: string;
  /** Harness stderr, trimmed to a bounded length. */
  stderr?: string;
  /** Human-readable failure reason when `ok` is false. */
  error?: string;
  /** Path of the JSON summary the harness wrote. */
  summaryPath?: string;
  /** Parsed harness summary; absent when the run or the read failed. */
  summary?: unknown;
}

export type AgentDomainDto = 'P2P_DESK' | 'FINANCE_360' | 'ARM_B2B' | 'SECURITY';
export type AgentRunTriggerTypeDto = 'daemon_tick' | 'manual_run' | 'sandbox_test' | 'copilot_mention';
export type AgentRunStatusDto =
  | 'running'
  | 'success'
  | 'error'
  | 'blocked_killswitch'
  | 'blocked_budget'
  | 'timeout';

export interface CustomAgentDto {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  isActive: boolean;
  executionMode: 'on_demand' | 'ambient_daemon';
  scheduleIntervalSec?: number;
  domain?: AgentDomainDto;
  dailyBudgetUsd?: number;
  maxSteps?: number;
  promptVersion?: number;
  skills: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateCustomAgentDto {
  id?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  modelProvider?: string;
  modelName?: string;
  temperature?: number;
  isActive?: boolean;
  executionMode?: 'on_demand' | 'ambient_daemon';
  scheduleIntervalSec?: number;
  domain?: AgentDomainDto;
  dailyBudgetUsd?: number;
  maxSteps?: number;
  skills?: string[];
}

export interface UpdateCustomAgentDto {
  name?: string;
  description?: string;
  systemPrompt?: string;
  modelProvider?: string;
  modelName?: string;
  temperature?: number;
  isActive?: boolean;
  executionMode?: 'on_demand' | 'ambient_daemon';
  scheduleIntervalSec?: number;
  domain?: AgentDomainDto;
  dailyBudgetUsd?: number;
  maxSteps?: number;
  skills?: string[];
}

export interface AgentRunToolEntryDto {
  name: string;
  ok: boolean;
  latencyMs?: number;
  blockedReason?: string;
}

export interface AgentRunDto {
  id: string;
  agentId: string;
  agentName?: string;
  triggerType: AgentRunTriggerTypeDto;
  status: AgentRunStatusDto;
  promptInput: string;
  responseOutput: string | null;
  toolsCalled: AgentRunToolEntryDto[];
  modelUsed: string;
  providerUsed: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  errorMessage: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface AgentRunFilterDto {
  agentId?: string;
  status?: AgentRunStatusDto;
  triggerType?: AgentRunTriggerTypeDto;
  limit?: number;
  offset?: number;
}

export interface PerAgentMetricSummaryDto {
  agentId: string;
  runs24h: number;
  errors24h: number;
  cost24hUsd: number;
  dailyBudgetUsd: number;
  lastRunAt: number | null;
  lastRunStatus: AgentRunStatusDto | null;
  avgLatencyMs: number;
}

export interface AgentFleetMetricsDto {
  totalAgents: number;
  activeAgents: number;
  activeDaemons: number;
  runs24h: number;
  success24h: number;
  errors24h: number;
  blocked24h: number;
  successRate24hPct: number;
  totalCost24hUsd: number;
  avgLatency24hMs: number;
  perAgent: PerAgentMetricSummaryDto[];
}

export interface DaemonSlotStatusDto {
  agentId: string;
  agentName: string;
  domain: string;
  modelName: string;
  intervalSec: number;
  isRunningNow: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: AgentRunStatusDto | null;
  dailySpendUsd: number;
  dailyBudgetUsd: number;
}

export interface DaemonSchedulerStatusDto {
  started: boolean;
  killswitchActive: boolean;
  activeDaemonCount: number;
  runningNowCount: number;
  slots: DaemonSlotStatusDto[];
}

export interface AgentRunEventDto {
  type: 'run_started' | 'run_completed' | 'daemon_reconciled';
  run?: AgentRunDto;
  status?: DaemonSchedulerStatusDto;
  timestamp: number;
}

export interface P2PIpcChannels {
  'app:get-version': {
    request: void;
    response: string;
  };
  'p2p:fetch-binance': {
    request: BinanceSearchParams;
    response: unknown;
  };
  'p2p:fetch-binance-spot': {
    request: string | readonly string[];
    response: unknown;
  };
  'p2p:fetch-binance-c2c-orders': {
    request: BinanceC2cOrdersFetchRequest;
    response: unknown;
  };
  'p2p:fetch-cotizave': {
    request: CotizaveRequest;
    response: unknown;
  };
  'p2p:fetch-bybit-p2p': {
    request: BybitP2pFetchRequest;
    response: unknown;
  };
  'p2p:fetch-eldorado-quote': {
    request: ElDoradoQuoteRequest;
    response: unknown;
  };
  'p2p:backtest-run': {
    request: BacktestRunRequest;
    response: BacktestRunResult;
  };
  'crypto:is-available': {
    request: void;
    response: boolean;
  };
  'crypto:encrypt': {
    request: string;
    response: string;
  };
  'crypto:decrypt': {
    request: string;
    response: string;
  };
  'p2p:db-save-order': {
    request: unknown;
    response: boolean;
  };
  'p2p:db-get-order': {
    request: string;
    response: unknown;
  };
  'p2p:db-list-active-orders': {
    request: void;
    response: unknown[];
  };
  'p2p:db-record-bank-event': {
    request: unknown;
    response: { isDuplicate: boolean; eventId: number };
  };
  'p2p:db-save-bank-account': {
    request: unknown;
    response: boolean;
  };
  'p2p:db-get-bank-account': {
    request: string;
    response: unknown;
  };
  'p2p:db-list-bank-accounts': {
    request: { status?: string; bankCode?: string } | void;
    response: unknown[];
  };
  'p2p:db-delete-bank-account': {
    request: string;
    response: boolean;
  };
  'p2p:db-list-market-snapshots': {
    request: { since?: number; until?: number; limit?: number } | void;
    response: unknown[];
  };
  'p2p:killswitch-trigger': {
    request: { reason?: string; source?: string };
    response: boolean;
  };
  'p2p:killswitch-status': {
    request: void;
    response: { isTriggered: boolean; timestamp?: number; reason?: string; source?: string };
  };
  'p2p:treasury-announce': {
    request: TreasurySnapshotDto;
    response: boolean;
  };
  'copilot:send-message': {
    request: CopilotSendMessageParams;
    response: CopilotResponse;
  };
  'copilot:execute-plan': {
    request: { planId: string };
    response: { success: boolean; error?: string };
  };
  'copilot:get-plans': {
    request: { limit?: number };
    response: StrategyPlanCard[];
  };
  'copilot:get-learnings': {
    request: { category?: string; limit?: number };
    response: {
      id?: number;
      topicKey: string;
      category: string;
      insight: string;
      confidenceScore: number;
      sampleCount: number;
      createdAt: number;
    }[];
  };
  'copilot:set-api-key': {
    request: { apiKey: string; provider?: string };
    response: boolean;
  };
  'copilot:set-provider-config': {
    request: { provider: string; model?: string; apiKey?: string };
    response: boolean;
  };
  'copilot:get-provider-config': {
    request: void;
    response: {
      activeProvider: string;
      activeModel: string;
      configuredProviders: Record<string, boolean>;
    };
  };
  'copilot:test-connection': {
    request: { provider?: string; apiKey?: string } | void;
    response: { success: boolean; model: string; message: string };
  };
  'copilot:get-watcher-status': {
    request: void;
    response: AlphaWatcherStatus;
  };
  'copilot:set-watcher-config': {
    request: Partial<AlphaWatcherConfigDto>;
    response: boolean;
  };
  'p2p:screen-pipe-sources': {
    request: void;
    response: ScreenPipeSource[];
  };
  'p2p:screen-pipe-capture': {
    request: { sourceId?: string } | void;
    response: { dataUrl: string; timestampMs: number } | null;
  };
  'p2p:mcp-status': {
    request: void;
    response: McpStatusDto;
  };
  'p2p:mcp-test-tool': {
    request: { toolName: string; args: unknown };
    response: { success: boolean; result?: unknown; error?: string; executionTimeMs: number };
  };
  'p2p:clipboard-watcher-toggle': {
    request: { enabled: boolean };
    response: boolean;
  };
  'p2p:clipboard-watcher-status': {
    request: void;
    response: { enabled: boolean; pollIntervalMs: number; lastDetectedReference?: string };
  };
  'agents:list': {
    request: { activeOnly?: boolean; mode?: 'on_demand' | 'ambient_daemon' } | undefined;
    response: CustomAgentDto[];
  };
  'agents:get': {
    request: { id: string };
    response: CustomAgentDto | null;
  };
  'agents:create': {
    request: CreateCustomAgentDto;
    response: CustomAgentDto;
  };
  'agents:update': {
    request: { id: string; dto: UpdateCustomAgentDto };
    response: CustomAgentDto | null;
  };
  'agents:delete': {
    request: { id: string };
    response: boolean;
  };
  'agents:toggle': {
    request: { id: string; active?: boolean };
    response: CustomAgentDto | null;
  };
  'agents:run-sandbox': {
    request: {
      agentId: string;
      prompt: string;
      overrideSystemPrompt?: string;
      overrideSkills?: string[];
      overrideModel?: string;
    };
    response: AgentRunDto;
  };
  'agents:run-now': {
    request: { agentId: string; promptOverride?: string };
    response: AgentRunDto;
  };
  'agents:list-runs': {
    request: AgentRunFilterDto | undefined;
    response: AgentRunDto[];
  };
  'agents:get-fleet-metrics': {
    request: void;
    response: AgentFleetMetricsDto;
  };
  'agents:get-daemon-status': {
    request: void;
    response: DaemonSchedulerStatusDto;
  };
  'arm:upsert-bank-rail': {
    request: ArmBankRailRecord;
    response: ArmBankRailRecord;
  };
  'arm:list-bank-rails': {
    request: ArmWorkspaceCode;
    response: ArmBankRailRecord[];
  };
  'arm:record-payment-receipt': {
    request: ArmPaymentReceiptInput;
    response: ArmPaymentReceiptRecordResult;
  };
  'arm:record-treasury-settlement': {
    request: ArmTreasurySettlementInput;
    response: ArmTreasurySettlementResult;
  };
  'f360:get-snapshot': {
    request: void;
    response: Finance360StoredSnapshot | null;
  };
  'f360:save-snapshot': {
    request: Finance360SnapshotPayload;
    response: Finance360SaveSnapshotResult;
  };
  'f360:ai-analyze': {
    request: Finance360AiAnalyzeRequest;
    response: Finance360AiAnalyzeResult;
  };
  'f360:export-pdf': {
    request: Finance360ExportPdfRequest;
    response: Finance360ExportPdfResult;
  };
  'p2p:dock-open': {
    request: BinanceDockOpenRequest;
    response: BinanceDockStateDto;
  };
  'p2p:dock-close': {
    request: void;
    response: BinanceDockStateDto;
  };
  'p2p:dock-toggle': {
    request: BinanceDockOpenRequest | undefined;
    response: BinanceDockStateDto;
  };
  'p2p:dock-state': {
    request: void;
    response: BinanceDockStateDto;
  };
  'p2p:open-external': {
    request: string;
    response: { opened: boolean };
  };
}

export const F360_LEDGER_ENTRY_TYPES = {
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  GOAL_RESERVE: 'GOAL_RESERVE',
} as const;

export type Finance360LedgerEntryType =
  (typeof F360_LEDGER_ENTRY_TYPES)[keyof typeof F360_LEDGER_ENTRY_TYPES];

export interface Finance360SnapshotPayload {
  version: number;
  assets: readonly Record<string, unknown>[];
  liabilities: readonly Record<string, unknown>[];
  incomes: readonly Record<string, unknown>[];
  expenses: readonly Record<string, unknown>[];
  ledgerEntries?: readonly Record<string, unknown>[];
  casheaPlans: readonly Record<string, unknown>[];
  providers: readonly Record<string, unknown>[];
  inventory: readonly Record<string, unknown>[];
  quotes: readonly Record<string, unknown>[];
  goals?: readonly Record<string, unknown>[];
  recurringRules?: readonly Record<string, unknown>[];
  casheaProfile?: Record<string, unknown> | null;
  casheaMerchantSales?: readonly Record<string, unknown>[];
  drawerLedger?: readonly Record<string, unknown>[];
  reconciliations?: readonly Record<string, unknown>[];
  businessProfile?: Record<string, unknown> | null;
  lastUpdated: string;
}

export interface Finance360EntityCounts {
  vaults: number;
  ledgerEntries: number;
  liabilities: number;
  casheaPlans: number;
  quotes: number;
  providers: number;
  inventoryItems: number;
  goals: number;
  recurringRules: number;
  casheaMerchantSales: number;
}

export interface Finance360StoredSnapshot {
  workspaceId: 'FINANCE_360';
  version: number;
  schemaVersion: number;
  checksum: string;
  updatedAt: number;
  snapshot: Finance360SnapshotPayload;
}

export interface Finance360SaveSnapshotResult {
  ok: boolean;
  workspaceId: 'FINANCE_360';
  version: number;
  checksum: string;
  updatedAt: number;
  counts: Finance360EntityCounts;
}

export interface Finance360AuditLogEntry {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  details?: string;
  severity: string;
  createdAt: number;
}

export interface Finance360AuditSummary {
  workspaceId: 'FINANCE_360';
  snapshotVersion: number;
  updatedAt: number | null;
  checksum: string | null;
  counts: Finance360EntityCounts;
  recentAuditLogs: readonly Finance360AuditLogEntry[];
}

export interface Finance360AiInlineData {
  mimeType: string;
  data: string;
}

export interface Finance360AiAnalyzeRequest {
  prompt: string;
  inlineData?: Finance360AiInlineData;
  temperature?: number;
  responseMimeType?: string;
}

export interface Finance360AiAnalyzeResult {
  ok: boolean;
  text: string;
  model: string;
  error?: string;
}

export interface Finance360ExportPdfRequest {
  html: string;
  filename?: string;
}

export interface Finance360ExportPdfResult {
  ok: boolean;
  base64?: string;
  filename?: string;
  error?: string;
}

export interface Finance360ElectronBridge {
  getSnapshot(): Promise<Finance360StoredSnapshot | null>;
  saveSnapshot(snapshot: Finance360SnapshotPayload): Promise<Finance360SaveSnapshotResult>;
  aiAnalyze(request: Finance360AiAnalyzeRequest): Promise<Finance360AiAnalyzeResult>;
  exportPdf(request: Finance360ExportPdfRequest): Promise<Finance360ExportPdfResult>;
}

export const ARM_WORKSPACES = {
  ARM_B2B: 'ARM_B2B',
  P2P_DESK: 'P2P_DESK',
  FINANCE_360: 'FINANCE_360',
} as const;

export type ArmWorkspaceCode = (typeof ARM_WORKSPACES)[keyof typeof ARM_WORKSPACES];

export const ARM_BANK_RAIL_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  SATURATED: 'SATURATED',
  COOLDOWN: 'COOLDOWN',
  DISABLED: 'DISABLED',
} as const;

export type ArmBankRailStatus =
  (typeof ARM_BANK_RAIL_STATUSES)[keyof typeof ARM_BANK_RAIL_STATUSES];

export interface ArmBankRailRecord {
  id: string;
  workspaceId: ArmWorkspaceCode;
  bankName: string;
  currency: string;
  holderDetails?: string | null;
  currentBalanceFiat: number;
  maxDailyCapFiat: number;
  status?: string;
  updatedAt?: number;
}

export interface ArmPaymentReceiptInput {
  id?: string;
  workspaceId: ArmWorkspaceCode;
  bankRailId: string;
  referenceCode: string;
  amountFiat?: number;
  dealId?: string | null;
  createdAt?: number;
}

export interface ArmPaymentReceiptRecord {
  id: string;
  workspaceId: ArmWorkspaceCode;
  bankRailId: string;
  referenceCode: string;
  amountFiat: number;
  dealId: string | null;
  createdAt: number;
}

export interface ArmPaymentReceiptRecordResult {
  recorded: boolean;
  collision: boolean;
  existingDealId?: string | null;
}

export interface ArmTreasurySettlementInput {
  id?: string;
  sourceWorkspace: ArmWorkspaceCode;
  targetWorkspace: ArmWorkspaceCode;
  idempotencyKey: string;
  netProfitUsdt: number;
  settlementDate: string;
  createdAt?: number;
}

export interface ArmTreasurySettlementRecord {
  id: string;
  sourceWorkspace: ArmWorkspaceCode;
  targetWorkspace: ArmWorkspaceCode;
  idempotencyKey: string;
  netProfitUsdt: number;
  settlementDate: string;
  createdAt: number;
}

export interface ArmTreasurySettlementResult {
  recorded: boolean;
  duplicate: boolean;
  settlement: ArmTreasurySettlementRecord;
}

export interface McpServerRuntimeInfo {
  id: string;
  name: string;
  category:
    | 'tasas'
    | 'mercado'
    | 'portafolio'
    | 'ledger'
    | 'master'
    | 'cloud'
    | 'seguridad'
    | 'compliance'
    | 'bancos'
    | 'legal'
    | 'operaciones';
  status: 'ONLINE' | 'OFFLINE' | 'STANDBY' | 'ERROR';
  transport: 'stdio' | 'sse';
  toolCount: number;
  resourceCount: number;
  uptimeSeconds: number;
  tools: { name: string; description: string }[];
  resources: { uri: string; name: string }[];
}

export interface McpAuditLogDto {
  timestamp: string;
  toolName: string;
  inputHash: string;
  outputHash: string;
  success: boolean;
  error?: string;
}

export interface McpStatusDto {
  servers: McpServerRuntimeInfo[];
  recentAuditLogs: McpAuditLogDto[];
  totalCallsServed: number;
  activeTransport: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface CopilotChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  plan?: StrategyPlanCard;
  provenance?: ProvenanceMetadata;
  sources?: GroundingSource[];
  searchQueries?: string[];
}

export interface StrategyPlanCard {
  id: string;
  title: string;
  route: string;
  capitalRequiredUsdt: number;
  expectedNetSpreadPct: number;
  expectedProfitUsdt: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedOperatorName?: string;
  rationale: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';
  esSimulado?: boolean;
  isSimulated?: boolean;
}

export interface AlphaWatcherConfigDto {
  pollIntervalSeconds: number;
  minNetSpreadPct: number;
  asset: string;
  fiat: string;
  payTypes: string[];
  enabled: boolean;
}

export interface AlphaWatcherStatus {
  enabled: boolean;
  pollIntervalSeconds: number;
  minNetSpreadPct: number;
  scanCount: number;
  lastOpportunity: { time: number; netSpreadPct: number; route: string } | null;
}

export type ExecutionProvenance =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'openrouter'
  | 'deterministic'
  | 'heuristic'
  | 'simulated';

export type MarketFeedReason = 'LIVE' | 'NO_BOOK' | 'STALE_BOOK' | 'INCOMPLETE_BOOK';

export interface ProvenanceMetadata {
  source: ExecutionProvenance;
  model?: string;
  provenanceId: string;
  timestamp: number;
  fallbackReason?: string;
  liveMarketFeedConnected?: boolean;
  esSimulado?: boolean;
  stepsCount?: number;
  maxSteps?: number;
  apiCallsCount?: number;
  /** Why the feed is or is not live. Makes a stale book distinguishable from a missing one. */
  marketFeedReason?: MarketFeedReason;
  /** Human-readable provenance shown to the operator, e.g. "[sin feed: libro vencido (12 min)]". */
  marketFeedNote?: string;
  /** True when this turn stopped at a turn-level paid-call budget. */
  budgetExhausted?: boolean;
  /** Paid Gemini calls made this turn, as an enforced budget rather than a report. */
  paidCallsThisTurn?: number;
  /** Hard ceiling for paid calls in a single user turn. */
  paidCallsBudget?: number;
}

/** One tool invocation inside a ReAct turn, surfaced to the operator as an audit trail. */
export interface ToolCallTrace {
  step: number;
  toolName: string;
  /** Short, redacted summary of the arguments the model passed. */
  argsSummary: string;
  durationMs: number;
  status: 'ok' | 'error';
  /** LIVE when the tool read a verified live feed, FALLBACK when it used offline values. */
  provenance: 'LIVE' | 'FALLBACK';
  outputSummary?: string;
}

/** Real token and cost metering for a single turn. */
export interface CopilotUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  cached: boolean;
}

/** Selects which live data domains are injected into the system instruction. */
export interface CopilotContextScope {
  orderbook?: boolean;
  treasury?: boolean;
  orders?: boolean;
  finance360?: boolean;
}

export interface CopilotResponse {
  reply: string;
  suggestedPlan?: StrategyPlanCard;
  skillsExecuted?: string[];
  learningsGenerated?: string[];
  provenance?: ProvenanceMetadata;
  sources?: GroundingSource[];
  searchQueries?: string[];
  /** Audit trail of every tool executed during the turn. */
  toolTraces?: ToolCallTrace[];
  /** Token, cost and latency metering for the turn. */
  usage?: CopilotUsage;
  /** Thread the turn was persisted to, when thread persistence is active. */
  threadId?: string;
  /** Echo of the caller request id, used to correlate stream events and cancellation. */
  requestId?: string;
  /** True when the operator cancelled the turn before completion. */
  cancelled?: boolean;
}

export interface CopilotAttachmentDto {
  mimeType: string;
  base64: string;
  name?: string;
}

export interface CopilotSendMessageParams {
  prompt: string;
  history?: CopilotChatMessage[];
  threadId?: string;
  agentId?: string;
  contextScope?: CopilotContextScope;
  requestId?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
  attachments?: CopilotAttachmentDto[];
}

export interface CopilotThreadDto {
  id: string;
  title: string;
  agentId?: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

export interface CopilotThreadMessageDto {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string | null;
  provider?: string | null;
  provenance?: ProvenanceMetadata | null;
  toolTraces?: ToolCallTrace[] | null;
  planId?: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  createdAt: number;
}

export interface CopilotWinRateSummaryDto {
  totalDecisions: number;
  verifiedOutcomes: number;
  winCount: number;
  winRatePct: number | null;
  avgModeledSpreadPct: number | null;
  avgRealizedSpreadPct: number | null;
  realizedProfitUsdt: number;
}

export interface CopilotUsageSummaryDto {
  windowHours: number;
  totalCalls: number;
  cachedCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  p95LatencyMs: number | null;
  byModel: {
    provider: string;
    model: string;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }[];
  winRate?: CopilotWinRateSummaryDto;
}

export type CopilotStreamPhase =
  | 'started'
  | 'tool_start'
  | 'tool_end'
  | 'synthesizing'
  | 'delta'
  | 'completed'
  | 'cancelled'
  | 'error';

/** Progress event pushed on `copilot:stream-event` while a turn is running. */
export interface CopilotStreamEvent {
  requestId: string;
  phase: CopilotStreamPhase;
  step?: number;
  toolName?: string;
  delta?: string;
  message?: string;
  timestamp: number;
}

export interface EngramReviewResult {
  success: boolean;
  id: number;
  status: 'active' | 'discarded' | 'not_found';
}

/**
 * Per-account slice of the treasury projection announced by the renderer.
 * Produced by `AccountsService.buildTreasurySnapshot()` in the Angular app.
 */
export interface TreasuryAccountSnapshotDto {
  id: string;
  bankName: string;
  bankCode: string;
  rail: string;
  /** Absent means ACTIVE, mirroring `BankAccount.status` in @p2p/core. */
  status?: 'ACTIVE' | 'DISABLED';
  dailyLimitVes: number;
  monthlyLimitVes?: number;
  remainingLimitVes: number;
  isOverLimit: boolean;
  isNearLimit: boolean;
  todayTransactionCount: number;
  maxDailyTransactions: number;
  velocityHealth: string;
  isAtThreshold: boolean;
}

/**
 * Plain, serializable projection of the renderer's real treasury state.
 *
 * This is the only channel through which the main process learns about bank accounts:
 * they live exclusively in renderer localStorage (`p2p.bank-accounts`) and are never
 * migrated to SQLite. It replaces the hardcoded daily-volume/daily-limit literals the
 * Risk Gatekeeper used to audit against.
 */
export interface TreasurySnapshotDto {
  /** Read-only on the main side: the payload is cached and inspected, never mutated. */
  accounts: readonly TreasuryAccountSnapshotDto[];
  totalBalanceVes: number;
  totalSpentTodayVes: number;
  totalReceivedTodayVes: number;
  /**
   * Sum of `dailyLimitVes` over ACTIVE accounts that declare a cap (0 means unlimited in
   * @p2p/core and is therefore excluded). 0 when every account is unlimited or disabled.
   */
  totalDailyLimitVes: number;
  nearLimitCount: number;
  overLimitCount: number;
  disabledCount: number;
  saturatedCount: number;
  rotationRecommendationId: string | null;
  generatedAt: number;
}

// The narrow, typed surface the preload exposes on `window.electron`.
export type BinanceDockMode = 'AD' | 'ADVERTISER' | 'MY_ADS' | 'ADV_POST';

export interface BinanceDockOpenRequest {
  url: string;
  mode: BinanceDockMode;
}

export interface BinanceDockStateDto {
  isOpen: boolean;
  currentUrl: string | null;
  widthPx: number;
  mode: BinanceDockMode | null;
}

export interface ElectronAPI {
  getVersion(): Promise<string>;
  fetchBinanceP2p(params: BinanceSearchParams): Promise<unknown>;
  fetchBinanceSpotTicker(symbol: string | readonly string[]): Promise<unknown>;
  fetchBinanceC2cOrders(req: BinanceC2cOrdersFetchRequest): Promise<unknown>;
  fetchCotizave(req: CotizaveRequest): Promise<unknown>;
  fetchBybitP2p(req: BybitP2pFetchRequest): Promise<unknown>;
  fetchElDoradoQuote(req: ElDoradoQuoteRequest): Promise<unknown>;
  /**
   * Runs the historical simulation harness in the main process. The renderer has
   * no Node access, so this is the only path to `scripts/backtest.cjs`. The
   * renderer may only select the pair/timeframe labels — never the script, the
   * interpreter or any argument list.
   */
  backtest: {
    run(req: BacktestRunRequest): Promise<BacktestRunResult>;
  };
  crypto: {
    isAvailable(): Promise<boolean>;
    encrypt(plaintext: string): Promise<string>;
    decrypt(ciphertext: string): Promise<string>;
  };
  db: {
    saveOrder(order: unknown): Promise<boolean>;
    getOrder(orderId: string): Promise<unknown>;
    listActiveOrders(): Promise<unknown[]>;
    recordBankEvent(event: unknown): Promise<{ isDuplicate: boolean; eventId: number }>;
    saveAuditLog(record: {
      id: string;
      timestamp: string;
      category: string;
      action: string;
      details?: string;
      severity: string;
      createdAt: number;
    }): Promise<boolean>;
    listAuditLogs(params?: { limit?: number; category?: string }): Promise<unknown[]>;
    saveOperationRecord(record: {
      id: string;
      timestamp: string;
      side: string;
      fiatAmount: number;
      cryptoAmount: number;
      price: number;
      bank: string;
      reference?: string;
      counterparty?: string;
      status: string;
      rawJson: string;
      createdAt: number;
    }): Promise<boolean>;
    listOperationRecords(params?: { limit?: number }): Promise<unknown[]>;
    saveBankAccount(account: unknown): Promise<boolean>;
    getBankAccount(id: string): Promise<unknown>;
    listBankAccounts(filter?: { status?: string; bankCode?: string }): Promise<unknown[]>;
    deleteBankAccount(id: string): Promise<boolean>;
    listMarketSnapshots(filter?: {
      since?: number;
      until?: number;
      limit?: number;
    }): Promise<unknown[]>;
  };
  killswitch: {
    trigger(params?: { reason?: string; source?: string }): Promise<boolean>;
    getStatus(): Promise<{
      isTriggered: boolean;
      timestamp?: number;
      reason?: string;
      source?: string;
    }>;
  };
  /**
   * Publish the real treasury state so the main process stops auditing against
   * hardcoded daily limits. Fire-and-forget from the caller's perspective; resolves to
   * true when the main process accepted and cached the payload.
   */
  announceTreasury(snapshot: TreasurySnapshotDto): Promise<boolean>;
  copilot: {
    sendMessage(params: CopilotSendMessageParams): Promise<CopilotResponse>;
    executePlan(params: {
      planId: string;
    }): Promise<{ success: boolean; error?: string; dispatchSummary?: any }>;
    getPlans(params?: { limit?: number }): Promise<StrategyPlanCard[]>;
    getLearnings(params?: { category?: string; limit?: number }): Promise<unknown[]>;
    setApiKey(params: { apiKey: string }): Promise<boolean>;
    testConnection(): Promise<{ success: boolean; model: string; message: string }>;
    getWatcherStatus(): Promise<AlphaWatcherStatus>;
    setWatcherConfig(params: Partial<AlphaWatcherConfigDto>): Promise<boolean>;
    cancelTurn?(params: { requestId?: string }): Promise<{ cancelled: boolean }>;
    listThreads?(params?: { limit?: number }): Promise<CopilotThreadDto[]>;
    createThread?(params?: { title?: string; agentId?: string }): Promise<CopilotThreadDto>;
    getThreadMessages?(params: {
      threadId: string;
      limit?: number;
    }): Promise<CopilotThreadMessageDto[]>;
    deleteThread?(params: { threadId: string }): Promise<boolean>;
    rejectPlan?(params: { planId: string; reason?: string }): Promise<{ success: boolean }>;
    reviewEngramObservation?(params: {
      id: number;
      action: 'approve' | 'discard';
    }): Promise<EngramReviewResult>;
    getUsageSummary?(params?: { windowHours?: number }): Promise<CopilotUsageSummaryDto>;
    onAlphaOpportunity?(
      callback: (data: { plan: StrategyPlanCard; detectedAt: number }) => void,
    ): () => void;
    onProactiveAlert?(callback: (payload: unknown) => void): () => void;
    onStreamEvent?(callback: (event: CopilotStreamEvent) => void): () => void;
  };
  screenPipe: {
    getSources(): Promise<ScreenPipeSource[]>;
    capture(sourceId?: string): Promise<{ dataUrl: string; timestampMs: number } | null>;
  };
  mcp: {
    getStatus(): Promise<McpStatusDto>;
    testTool(
      toolName: string,
      args: unknown,
    ): Promise<{ success: boolean; result?: unknown; error?: string; executionTimeMs: number }>;
  };
  clipboard: {
    toggleWatcher(enabled: boolean): Promise<boolean>;
    getWatcherStatus(): Promise<{
      enabled: boolean;
      pollIntervalMs: number;
      lastDetectedReference?: string;
    }>;
    onPaymentDetected(callback: (payload: ClipboardPaymentPayload) => void): () => void;
  };
  agents: {
    list(filter?: {
      activeOnly?: boolean;
      mode?: 'on_demand' | 'ambient_daemon';
      domain?: AgentDomainDto;
    }): Promise<CustomAgentDto[]>;
    get(id: string): Promise<CustomAgentDto | null>;
    create(dto: CreateCustomAgentDto): Promise<CustomAgentDto>;
    update(id: string, dto: UpdateCustomAgentDto): Promise<CustomAgentDto | null>;
    delete(id: string): Promise<boolean>;
    toggle(id: string, active?: boolean): Promise<CustomAgentDto | null>;
    runSandbox?(params: {
      agentId: string;
      prompt: string;
      overrideSystemPrompt?: string;
      overrideSkills?: string[];
      overrideModel?: string;
    }): Promise<AgentRunDto>;
    runNow?(params: { agentId: string; promptOverride?: string }): Promise<AgentRunDto>;
    listRuns?(filter?: AgentRunFilterDto): Promise<AgentRunDto[]>;
    getFleetMetrics?(): Promise<AgentFleetMetricsDto>;
    getDaemonStatus?(): Promise<DaemonSchedulerStatusDto>;
    onRunEvent?(callback: (event: AgentRunEventDto) => void): () => void;
  };
  telegram?: {
    downloadFile(params: {
      token: string;
      filePath: string;
    }): Promise<{ success: boolean; base64: string; mimeType: string }>;
  };
  arm?: {
    listLeads(workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360'): Promise<unknown[]>;
    upsertLead(lead: unknown): Promise<unknown>;
    listPendingApprovals(workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360'): Promise<unknown[]>;
    saveApproval(item: unknown): Promise<unknown>;
    resolveApproval(params: {
      id: string;
      status: 'APPROVED' | 'EDITED_AND_APPROVED' | 'REJECTED';
      approvedText?: string;
      saveAsExample?: boolean;
    }): Promise<unknown>;
    listShadowExamples(params: {
      workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360';
      agentRole?: string;
      limit?: number;
    }): Promise<unknown[]>;
    appendOutboxEvent(params: {
      workspaceId: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360';
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    }): Promise<unknown>;
    listOutboxSince(params: {
      sinceId: number;
      workspaceId?: 'ARM_B2B' | 'P2P_DESK' | 'FINANCE_360';
    }): Promise<unknown[]>;
    upsertBankRail(rail: ArmBankRailRecord): Promise<ArmBankRailRecord>;
    listBankRails(workspaceId: ArmWorkspaceCode): Promise<ArmBankRailRecord[]>;
    recordPaymentReceipt(receipt: ArmPaymentReceiptInput): Promise<ArmPaymentReceiptRecordResult>;
    recordTreasurySettlement(
      settlement: ArmTreasurySettlementInput,
    ): Promise<ArmTreasurySettlementResult>;
    getGatewayConfig(): Promise<{ url: string; authToken: string }>;
  };
  finance360: Finance360ElectronBridge;
  binanceDock: {
    open(req: BinanceDockOpenRequest): Promise<BinanceDockStateDto>;
    close(): Promise<BinanceDockStateDto>;
    toggle(req?: BinanceDockOpenRequest): Promise<BinanceDockStateDto>;
    getState(): Promise<BinanceDockStateDto>;
    openExternal(url: string): Promise<{ opened: boolean }>;
    onStateChanged(listener: (state: BinanceDockStateDto) => void): () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
