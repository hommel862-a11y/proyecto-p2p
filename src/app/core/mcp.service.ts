import { Injectable, signal, computed } from '@angular/core';
import type {
  McpStatusDto,
  McpServerRuntimeInfo,
  McpAuditLogDto,
} from '../../../electron/shared/types';
import { FALLBACK_MCP_SERVERS } from './mcp/mcp-catalog';
import { simulateMcpTool } from './mcp/mcp-fallbacks';

export { FALLBACK_MCP_SERVERS };


@Injectable({
  providedIn: 'root',
})
export class McpService {
  private readonly _status = signal<McpStatusDto>({
    servers: FALLBACK_MCP_SERVERS,
    recentAuditLogs: [
      {
        timestamp: new Date().toISOString(),
        toolName: 'calculate_spread',
        inputHash: 'a7f9bc8812e987c1',
        outputHash: 'd3e108f9cba7041a',
        success: true,
      },
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        toolName: 'evaluate_trade_risk',
        inputHash: 'c4e99f120194beef',
        outputHash: '8b7f00912fa874cd',
        success: true,
      },
    ],
    totalCallsServed: 142,
    activeTransport: 'stdio',
  });

  private readonly _loading = signal<boolean>(false);
  private readonly _lastError = signal<string | null>(null);

  readonly status = computed(() => this._status());
  readonly servers = computed(() => this._status().servers);
  readonly recentAuditLogs = computed(() => this._status().recentAuditLogs);
  readonly totalCallsServed = computed(() => this._status().totalCallsServed);
  readonly activeTransport = computed(() => this._status().activeTransport);
  readonly isLoading = computed(() => this._loading());
  readonly lastError = computed(() => this._lastError());

  readonly onlineCount = computed(() => this.servers().filter((s) => s.status === 'ONLINE').length);

  readonly totalToolsCount = computed(() =>
    this.servers().reduce((acc, s) => acc + s.toolCount, 0),
  );

  constructor() {
    this.loadStatus();
  }

  async loadStatus(): Promise<void> {
    this._loading.set(true);
    this._lastError.set(null);

    try {
      if (typeof window !== 'undefined' && window.electron?.mcp?.getStatus) {
        const dto = await window.electron.mcp.getStatus();
        this._status.set(dto);
      } else {
        // Web fallback
        this._status.update((cur) => ({
          ...cur,
          servers: FALLBACK_MCP_SERVERS,
        }));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._lastError.set(msg);
    } finally {
      this._loading.set(false);
    }
  }

  async testTool(
    toolName: string,
    args: unknown,
  ): Promise<{ success: boolean; result?: unknown; error?: string; executionTimeMs: number }> {
    if (typeof window !== 'undefined' && window.electron?.mcp?.testTool) {
      try {
        const res = await window.electron.mcp.testTool(toolName, args);
        await this.loadStatus();
        return res;
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          executionTimeMs: 0,
        };
      }
    }

    // Web simulation
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 120));
    const executionTimeMs = Date.now() - start;

    const dummyLog: McpAuditLogDto = {
      timestamp: new Date().toISOString(),
      toolName,
      inputHash: 'web_hash_' + Math.random().toString(36).substring(7),
      outputHash: 'out_hash_' + Math.random().toString(36).substring(7),
      success: true,
    };

    this._status.update((cur) => ({
      ...cur,
      totalCallsServed: cur.totalCallsServed + 1,
      recentAuditLogs: [dummyLog, ...cur.recentAuditLogs.slice(0, 19)],
    }));

    const simulatedResult = simulateMcpTool(toolName, args, executionTimeMs);

    return {
      success: true,
      result: simulatedResult,
      executionTimeMs,
    };
  }

  // ─── High-Level Typed MCP Tool Invocations ─────────────────────────

  async calculateSpread(input: {
    buyPrice: number;
    sellPrice: number;
    makerFeePct?: number;
    takerFeePct?: number;
  }) {
    return this.testTool('calculate_spread', input);
  }

  async evaluateTradeRisk(input: {
    tradeAmountUsdt: number;
    fiatCurrency?: string;
    counterpartyScore?: number;
    currentCapitalUsdt: number;
  }) {
    return this.testTool('evaluate_trade_risk', input);
  }

  async simulateTradeImpact(input: {
    proposedTradeAmountUsdt: number;
    currentExposureUsdt: number;
    maxDailyExposureLimitUsdt: number;
    consecutiveLosses?: number;
  }) {
    return this.testTool('simulate_trade_impact', input);
  }

  async consultZkMarketMesh(input: { rawIdentifier: string; saltDomain?: string }) {
    return this.testTool('consult_zk_market_mesh', input);
  }

  async forecastVolatilityWindow(input: {
    parallelRate: number;
    bcvRate: number;
    currentSpreadPct?: number;
    askDepthUsdt?: number;
    bidDepthUsdt?: number;
  }) {
    return this.testTool('forecast_volatility_window', input);
  }

  async calculateDeltaNeutralHedge(input: {
    vesBalance: number;
    usdtReferencePrice: number;
    targetHedgePct?: number;
  }) {
    return this.testTool('calculate_delta_neutral_hedge', input);
  }

  async triggerKillswitch(input: { reason: string; source?: string; humanConfirm: boolean }) {
    return this.testTool('trigger_killswitch', input);
  }

  async addOperationEntry(input: {
    side: 'buy' | 'sell';
    vesAmount: number;
    usdtAmount: number;
    price: number;
    notes?: string;
    humanConfirm: boolean;
  }) {
    return this.testTool('add_operation_entry', input);
  }

  async getBcvRates(input?: { cacheFallback?: boolean }) {
    return this.testTool('get_bcv_rates', input ?? {});
  }

  async getParallelRates(input?: { includeSources?: string[] }) {
    return this.testTool('get_parallel_rates', input ?? {});
  }

  async calculateRateGap(input: { parallelRate: number; bcvRate: number }) {
    return this.testTool('calculate_rate_gap', input);
  }

  async checkBcvInterventionWindow(input?: { testTimestamp?: string }) {
    return this.testTool('check_bcv_intervention_window', input ?? {});
  }

  async autofillTradeReference(input: {
    side: 'BUY' | 'SELL';
    targetMarginPct: number;
    fallbackRate?: number;
  }) {
    return this.testTool('autofill_trade_reference', input);
  }

  async getBinanceP2pOrderbook(input: { fiat: string; asset?: string; rows?: number }) {
    return this.testTool('get_binance_p2p_orderbook', input);
  }

  async detectUsdtDepeg(input: { spotUsdtPrice: number; thresholdPct?: number }) {
    return this.testTool('detect_usdt_depeg', input);
  }

  async recommendCompetitivePricing(input: {
    side: 'BUY' | 'SELL';
    strategy?: 'TOP_1' | 'TOP_2' | 'TOP_3' | 'UNDERCUT';
    stepVes?: number;
    targetMarginPct?: number;
    breakEvenPrice?: number;
    currentMarketMid?: number;
  }) {
    return this.testTool('recommend_competitive_pricing', input);
  }

  async analyzeOrderbookPressure(input: {
    fiat: string;
    bidDepthUsdt: number;
    askDepthUsdt: number;
    includeSpoofCheck?: boolean;
  }) {
    return this.testTool('analyze_orderbook_pressure', input);
  }

  async stressTestPortfolio(input: {
    usdtCapital: number;
    vesCapital: number;
    referenceRate: number;
    devaluationScenariosPct?: number[];
    hedgedPct?: number;
  }) {
    return this.testTool('stress_test_portfolio', input);
  }

  async rebalanceCapitalAllocation(input: {
    totalCapitalUsdt: number;
    referenceRate?: number;
    riskMode?: 'CONSERVATIVE' | 'AGGRESSIVE' | 'BALANCED';
    hourOfDay?: number;
  }) {
    return this.testTool('rebalance_capital_allocation', input);
  }

  async auditCounterpartyExposure(input: {
    counterpartyAlias?: string;
    historicalTradesCount?: number;
    disputeThresholdPct?: number;
    maxConcentrationPct?: number;
  }) {
    return this.testTool('audit_counterparty_exposure', input);
  }

  async projectCompoundRunway(input: {
    initialCapitalUsdt: number;
    netMarginPctPerCycle: number;
    cyclesPerDay: number;
    operationalDays: number;
    reinvestmentRatePct: number;
    monthlyFixedExpensesUsdt?: number;
    dailyBankLimitVes?: number;
  }) {
    return this.testTool('project_compound_runway', input);
  }

  async gdriveBackupReceipt(input: {
    tradeId: string;
    counterparty?: string;
    imageData: string;
    fileName?: string;
    mimeType?: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
    folderId?: string;
    amountVes?: number;
    amountUsdt?: number;
    bank?: string;
    timestamp?: string;
  }) {
    return this.testTool('gdrive_backup_receipt', input);
  }

  async gsheetsSyncTrade(input: {
    spreadsheetId?: string;
    sheetName?: string;
    trade: {
      id: string;
      timestamp?: string;
      side: 'BUY' | 'SELL';
      bank?: string;
      rate: number;
      vesAmount: number;
      usdtAmount: number;
      grossSpreadPct?: number;
      netProfitUsdt?: number;
      counterparty?: string;
      referenceNumber?: string;
      status?: 'COMPLETED' | 'DISPUTED' | 'CANCELLED';
    };
  }) {
    return this.testTool('gsheets_sync_trade', input);
  }

  async gdriveSyncDbBackup(input: {
    backupType?: 'ledger_json' | 'sqlite_dump' | 'audit_snapshot';
    dataPayload: string;
    folderId?: string;
    encrypt?: boolean;
  }) {
    return this.testTool('gdrive_sync_db_backup', input);
  }

  // ─── Institutional 10 MCP Servers: Typed Wrappers ──────────────────

  async screenWalletAddress(input: {
    address: string;
    network?: 'TRC20' | 'ERC20' | 'BEP20' | 'POLYGON' | 'SOL';
    expectedAmountUsdt?: number;
  }) {
    return this.testTool('screen_wallet_address', input);
  }

  async inspectTxTaint(input: { txHash: string; chain?: 'TRON' | 'ETHEREUM' | 'BSC' | 'POLYGON' }) {
    return this.testTool('inspect_tx_taint', input);
  }

  async fetchCrossExchangeSpread(input: {
    fiat?: 'VES' | 'COP' | 'USD';
    asset?: 'USDT' | 'BTC';
    paymentMethod?: string;
    minMerchantTrades?: number;
  }) {
    return this.testTool('fetch_cross_exchange_spread', input);
  }

  async verifyInboundTransfer(input: {
    referenceNumber: string;
    amountVes: number;
    bankCode?: string;
    senderPhone?: string;
    senderCedula?: string;
  }) {
    return this.testTool('verify_inbound_transfer', input);
  }

  async compileDisputeDossier(input: {
    orderId: string;
    disputeReason:
      'THIRD_PARTY_PAYMENT' | 'UNRELEASED_CRYPTO' | 'FAKE_RECEIPT' | 'INCORRECT_AMOUNT';
    bankReference?: string;
    amountUsdt: number;
    amountVes: number;
    counterpartyNick: string;
    chatLogSummary?: string;
  }) {
    return this.testTool('compile_dispute_dossier', input);
  }

  async evaluateAccountSaturation(input: {
    bankId: string;
    currentDailyVes: number;
    dailyLimitVes: number;
    hourlyTransactionCount?: number;
    incomingAmountVes?: number;
  }) {
    return this.testTool('evaluate_account_saturation', input);
  }

  async dispatchOrderInstructions(input: {
    orderId: string;
    channel?: 'TELEGRAM' | 'WHATSAPP' | 'BINANCE_CHAT';
    recipientContact: string;
    bankName: string;
    accountHolder: string;
    accountNumberOrPhone: string;
    amountVes: number;
    termsNote?: string;
  }) {
    return this.testTool('dispatch_order_instructions', input);
  }

  async lookupCounterpartyReputation(input: {
    documentId: string;
    phoneNumber?: string;
    bankAccountNumber?: string;
  }) {
    return this.testTool('lookup_counterparty_reputation', input);
  }

  // ─── Compliance, Multichannel & Proof Reader: Typed Wrappers ───────

  async checkBankOperationalStatus(input?: {
    bankCodes?: string[];
    includePaymentNetworks?: boolean;
  }) {
    return this.testTool('check_bank_operational_status', input ?? {});
  }

  async checkCounterpartyBlacklist(input: {
    cedula?: string;
    phone?: string;
    accountNumber?: string;
    alias?: string;
  }) {
    return this.testTool('check_counterparty_blacklist', input);
  }

  async registerBlacklistedEntity(input: {
    identifierType: 'CEDULA' | 'PHONE' | 'ACCOUNT_NUMBER' | 'BINANCE_ALIAS';
    identifierValue: string;
    counterpartyName?: string;
    fraudCategory:
      | 'TRIANGULATION_SCAM'
      | 'THIRD_PARTY_PAYER'
      | 'CHARGEBACK_ATTEMPT'
      | 'IDENTITY_THEFT'
      | 'OTHER';
    incidentNotes?: string;
    riskLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    humanConfirm: boolean;
    confirmToken?: string;
  }) {
    return this.testTool('register_blacklisted_entity', input);
  }

  async sendMultichannelAlert(input: {
    channel?: 'TELEGRAM' | 'WHATSAPP' | 'PUSH' | 'ALL';
    priority?: 'INFO' | 'ALERT' | 'CRITICAL_ACTION';
    title: string;
    messageMarkdown: string;
    actionButtons?: { label: string; callbackAction: string }[];
    orderId?: string;
  }) {
    return this.testTool('send_multichannel_alert', input);
  }

  async processRemoteSentinelCommand(input: {
    rawText: string;
    senderId?: string;
    channel?: 'TELEGRAM' | 'WHATSAPP' | 'VOICE_TRANSCRIPTION';
    humanConfirm?: boolean;
  }) {
    return this.testTool('process_remote_sentinel_command', input);
  }

  async auditPaymentProofOcr(input: {
    ocrRawText: string;
    expectedAmountVes: number;
    expectedBank?: string;
    expectedPayerName?: string;
    expectedPayerIdDoc?: string;
    orderId: string;
  }) {
    return this.testTool('audit_payment_proof_ocr', input);
  }

  generateConfigSnippet(client: 'antigravity' | 'claude' | 'cli'): string {
    const serverPath = 'E:/05_Proyectos/proyecto p2p/packages/mcp-server/dist/index.js';

    if (client === 'cli') {
      return `node "${serverPath}"`;
    }

    const configObj = {
      mcpServers: {
        'p2p-decisor': {
          command: 'node',
          args: [serverPath],
          env: {
            NODE_ENV: 'production',
          },
        },
      },
    };

    return JSON.stringify(configObj, null, 2);
  }
}
