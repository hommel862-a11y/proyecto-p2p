import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { McpService } from '../../core/mcp.service';

@Component({
  selector: 'app-mcp-hub',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mcp-hub.html',
  styleUrls: ['./mcp-hub.scss'],
})
export class McpHub {
  readonly mcp = inject(McpService);

  readonly activeTab = signal<'servers' | 'tools' | 'config' | 'audit'>('servers');
  readonly selectedCategory = signal<string>('all');
  readonly selectedTool = signal<{ name: string; description: string } | null>(null);
  readonly toolArgsJson = signal<string>('{\n  "buyPrice": 100,\n  "sellPrice": 101.5\n}');
  readonly testExecutionResult = signal<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTimeMs?: number;
  } | null>(null);
  readonly isExecuting = signal<boolean>(false);
  readonly copySuccess = signal<string | null>(null);

  readonly filteredServers = computed(() => {
    const cat = this.selectedCategory();
    const list = this.mcp.servers();
    if (cat === 'all') return list;
    return list.filter((s) => s.category === cat);
  });

  readonly allTools = computed(() => {
    const list: { serverId: string; serverName: string; name: string; description: string }[] = [];
    for (const s of this.mcp.servers()) {
      for (const t of s.tools) {
        list.push({
          serverId: s.id,
          serverName: s.name,
          name: t.name,
          description: t.description,
        });
      }
    }
    return list;
  });

  setTab(tab: 'servers' | 'tools' | 'config' | 'audit'): void {
    this.activeTab.set(tab);
  }

  setCategory(cat: string): void {
    this.selectedCategory.set(cat);
  }

  selectTool(t: { name: string; description: string }): void {
    this.selectedTool.set(t);
    this.testExecutionResult.set(null);

    // Default sample payloads per tool with real valid Venezuelan / P2P market data
    const PAYLOAD_SAMPLES: Record<string, unknown> = {
      // Gateway Maestro
      calculate_spread: { buyPrice: 78.5, sellPrice: 79.8, makerFeePct: 0.35, takerFeePct: 0 },
      evaluate_trade_risk: {
        tradeAmountUsdt: 500,
        fiatCurrency: 'VES',
        counterpartyScore: 98,
        currentCapitalUsdt: 5000,
      },
      simulate_trade_impact: {
        proposedTradeAmountUsdt: 600,
        currentExposureUsdt: 400,
        maxDailyExposureLimitUsdt: 2500,
        consecutiveLosses: 0,
      },
      consult_zk_market_mesh: { rawIdentifier: 'V-18456789', saltDomain: 'p2p-arbitrage-vzla' },
      forecast_volatility_window: {
        parallelRate: 79.5,
        bcvRate: 64.8,
        currentSpreadPct: 1.6,
        askDepthUsdt: 8000,
        bidDepthUsdt: 9500,
      },
      calculate_delta_neutral_hedge: {
        vesBalance: 120000,
        usdtReferencePrice: 79.5,
        targetHedgePct: 100,
      },
      trigger_killswitch: {
        reason: 'Auditoría preventiva de seguridad',
        source: 'MCP_TEST_PLAYGROUND',
        humanConfirm: true,
      },
      add_operation_entry: {
        side: 'buy',
        vesAmount: 39750,
        usdtAmount: 500,
        price: 79.5,
        notes: 'Arbitraje Pago Móvil Banesco',
        humanConfirm: true,
      },
      // Phase 2: Tasas & BCV
      get_bcv_rates: { cacheFallback: true },
      get_parallel_rates: { includeSources: ['EnParaleloVzla', 'CotizaVe', 'BinanceP2P'] },
      calculate_rate_gap: { parallelRate: 79.5, bcvRate: 64.8 },
      check_bcv_intervention_window: {},
      autofill_trade_reference: { side: 'BUY', targetMarginPct: 1.2, fallbackRate: 79.2 },
      // Phase 3: Crypto Market Data
      get_binance_p2p_orderbook: { fiat: 'VES', asset: 'USDT', rows: 5 },
      detect_usdt_depeg: { spotUsdtPrice: 0.9992, thresholdPct: 0.2 },
      recommend_competitive_pricing: {
        side: 'BUY',
        strategy: 'TOP_1',
        stepVes: 0.05,
        targetMarginPct: 1.15,
        breakEvenPrice: 78.2,
      },
      analyze_orderbook_pressure: {
        fiat: 'VES',
        bidDepthUsdt: 18000,
        askDepthUsdt: 14000,
        includeSpoofCheck: true,
      },
      // Phase 4: Portfolio & Risk
      stress_test_portfolio: {
        usdtCapital: 8000,
        vesCapital: 160000,
        referenceRate: 79.5,
        devaluationScenariosPct: [5, 10, 20],
        hedgedPct: 50,
      },
      rebalance_capital_allocation: {
        totalCapitalUsdt: 10000,
        referenceRate: 79.5,
        riskMode: 'BALANCED',
      },
      audit_counterparty_exposure: {
        counterpartyAlias: 'VnzlaTrader_Pro',
        historicalTradesCount: 45,
        disputeThresholdPct: 5,
        maxConcentrationPct: 20,
      },
      project_compound_runway: {
        initialCapitalUsdt: 5000,
        netMarginPctPerCycle: 0.9,
        cyclesPerDay: 2,
        operationalDays: 30,
        reinvestmentRatePct: 100,
        monthlyFixedExpensesUsdt: 200,
      },
      // Phase 5: Google Workspace Integration
      gdrive_backup_receipt: {
        tradeId: 'ORD-99120',
        counterparty: 'CaracasExchange',
        imageData:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
        amountVes: 16500,
        amountUsdt: 200,
        bank: 'Banesco',
      },
      gsheets_sync_trade: {
        spreadsheetId: '1p2p_Ledger_Master_Spreadsheet',
        sheetName: 'Operaciones P2P',
        trade: {
          id: 'TX-5021',
          side: 'BUY',
          bank: 'Pago Móvil',
          rate: 82.5,
          vesAmount: 82500,
          usdtAmount: 1000,
          grossSpreadPct: 1.25,
          netProfitUsdt: 12.5,
          counterparty: 'VzlaArbitrage',
          referenceNumber: '782910',
        },
      },
      gdrive_sync_db_backup: {
        backupType: 'ledger_json',
        dataPayload: '{"backup":"ok","tradesCount":25,"ledgerTimestamp":"2026-09-16"}',
        encrypt: false,
      },
      // Institutional 10 MCP Servers: New High-Impact Tools
      screen_wallet_address: {
        address: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36GunL',
        network: 'TRC20',
        expectedAmountUsdt: 500,
      },
      inspect_tx_taint: {
        txHash: 'e4d909c290d0fb1ca068ffaddf22cbd0d0c35',
        chain: 'TRON',
      },
      fetch_cross_exchange_spread: {
        fiat: 'VES',
        asset: 'USDT',
        paymentMethod: 'Pago Movil',
        minMerchantTrades: 50,
      },
      verify_inbound_transfer: {
        referenceNumber: '984721',
        amountVes: 12500.5,
        bankCode: '0102',
        senderCedula: 'V-19876543',
      },
      compile_dispute_dossier: {
        orderId: 'ORD-2026-99128',
        disputeReason: 'THIRD_PARTY_PAYMENT',
        amountUsdt: 850,
        amountVes: 67320,
        counterpartyNick: 'TraderFraudster99',
        chatLogSummary:
          'Comprador envió comprobante a nombre de Juan Pérez pero la cuenta bancaria es de María López.',
      },
      evaluate_account_saturation: {
        bankId: 'banesco_01',
        currentDailyVes: 450000,
        dailyLimitVes: 500000,
        hourlyTransactionCount: 9,
        incomingAmountVes: 60000,
      },
      dispatch_order_instructions: {
        orderId: 'P2P-55182',
        channel: 'TELEGRAM',
        recipientContact: '@TraderVipVzla',
        bankName: 'Banesco',
        accountHolder: 'Inversiones Desk Pro C.A.',
        accountNumberOrPhone: '0414-1234567',
        amountVes: 39500,
      },
      lookup_counterparty_reputation: {
        documentId: 'V-20123456',
        phoneNumber: '04121234567',
      },
    };

    const sample = PAYLOAD_SAMPLES[t.name] ?? { simulated: true };
    this.toolArgsJson.set(JSON.stringify(sample, null, 2));
  }

  async runToolTest(): Promise<void> {
    const tool = this.selectedTool();
    if (!tool) return;

    this.isExecuting.set(true);
    this.testExecutionResult.set(null);

    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(this.toolArgsJson());
    } catch {
      this.testExecutionResult.set({
        success: false,
        error: 'JSON inválido en los argumentos de prueba.',
      });
      this.isExecuting.set(false);
      return;
    }

    try {
      const res = await this.mcp.testTool(tool.name, parsedArgs);
      this.testExecutionResult.set(res);
    } catch (err: unknown) {
      this.testExecutionResult.set({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isExecuting.set(false);
    }
  }

  copyConfig(client: 'antigravity' | 'claude' | 'cli'): void {
    const snippet = this.mcp.generateConfigSnippet(client);
    navigator.clipboard.writeText(snippet).then(() => {
      this.copySuccess.set(`¡Configuración para ${client.toUpperCase()} copiada al portapapeles!`);
      setTimeout(() => this.copySuccess.set(null), 3500);
    });
  }

  refresh(): void {
    this.mcp.loadStatus();
  }
}
