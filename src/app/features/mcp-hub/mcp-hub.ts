import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { McpService } from '../../core/mcp.service';
import type { McpServerRuntimeInfo } from '../../../../electron/shared/types';

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
  readonly testExecutionResult = signal<any>(null);
  readonly isExecuting = signal<boolean>(false);
  readonly copySuccess = signal<string | null>(null);

  readonly filteredServers = computed(() => {
    const cat = this.selectedCategory();
    const list = this.mcp.servers();
    if (cat === 'all') return list;
    return list.filter((s) => s.category === cat);
  });

  readonly allTools = computed(() => {
    const list: Array<{ serverId: string; serverName: string; name: string; description: string }> = [];
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
      evaluate_trade_risk: { tradeAmountUsdt: 500, fiatCurrency: 'VES', counterpartyScore: 98, currentCapitalUsdt: 5000 },
      simulate_trade_impact: { proposedTradeAmountUsdt: 600, currentExposureUsdt: 400, maxDailyExposureLimitUsdt: 2500, consecutiveLosses: 0 },
      consult_zk_market_mesh: { rawIdentifier: 'V-18456789', saltDomain: 'p2p-arbitrage-vzla' },
      forecast_volatility_window: { parallelRate: 79.5, bcvRate: 64.8, currentSpreadPct: 1.6, askDepthUsdt: 8000, bidDepthUsdt: 9500 },
      calculate_delta_neutral_hedge: { vesBalance: 120000, usdtReferencePrice: 79.5, targetHedgePct: 100 },
      trigger_killswitch: { reason: 'Auditoría preventiva de seguridad', source: 'MCP_TEST_PLAYGROUND', humanConfirm: true },
      add_operation_entry: { side: 'buy', vesAmount: 39750, usdtAmount: 500, price: 79.5, notes: 'Arbitraje Pago Móvil Banesco', humanConfirm: true },
      // Phase 2: Tasas & BCV
      get_bcv_rates: { cacheFallback: true },
      get_parallel_rates: { includeSources: ['EnParaleloVzla', 'CotizaVe', 'BinanceP2P'] },
      calculate_rate_gap: { parallelRate: 79.5, bcvRate: 64.8 },
      check_bcv_intervention_window: {},
      autofill_trade_reference: { side: 'BUY', targetMarginPct: 1.2, fallbackRate: 79.2 },
      // Phase 3: Crypto Market Data
      get_binance_p2p_orderbook: { fiat: 'VES', asset: 'USDT', rows: 5 },
      detect_usdt_depeg: { spotUsdtPrice: 0.9992, thresholdPct: 0.2 },
      recommend_competitive_pricing: { side: 'BUY', strategy: 'TOP_1', stepVes: 0.05, targetMarginPct: 1.15, breakEvenPrice: 78.2 },
      analyze_orderbook_pressure: { fiat: 'VES', bidDepthUsdt: 18000, askDepthUsdt: 14000, includeSpoofCheck: true },
      // Phase 4: Portfolio & Risk
      stress_test_portfolio: { usdtCapital: 8000, vesCapital: 160000, referenceRate: 79.5, devaluationScenariosPct: [5, 10, 20], hedgedPct: 50 },
      rebalance_capital_allocation: { totalCapitalUsdt: 10000, referenceRate: 79.5, riskMode: 'BALANCED' },
      audit_counterparty_exposure: { counterpartyAlias: 'VnzlaTrader_Pro', historicalTradesCount: 45, disputeThresholdPct: 5, maxConcentrationPct: 20 },
      project_compound_runway: { initialCapitalUsdt: 5000, netMarginPctPerCycle: 0.9, cyclesPerDay: 2, operationalDays: 30, reinvestmentRatePct: 100, monthlyFixedExpensesUsdt: 200 },
    };

    const sample = PAYLOAD_SAMPLES[t.name] ?? { simulated: true };
    this.toolArgsJson.set(JSON.stringify(sample, null, 2));
  }

  async runToolTest(): Promise<void> {
    const tool = this.selectedTool();
    if (!tool) return;

    this.isExecuting.set(true);
    this.testExecutionResult.set(null);

    let parsedArgs: unknown = {};
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
