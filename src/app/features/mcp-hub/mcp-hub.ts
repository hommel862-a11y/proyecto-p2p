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

    // Default sample payloads per tool
    if (t.name === 'calculate_spread') {
      this.toolArgsJson.set('{\n  "buyPrice": 100,\n  "sellPrice": 101.5,\n  "makerFeePct": 0,\n  "takerFeePct": 0\n}');
    } else if (t.name === 'evaluate_trade_risk') {
      this.toolArgsJson.set('{\n  "tradeAmountUsdt": 250,\n  "fiatCurrency": "VES",\n  "counterpartyScore": 95\n}');
    } else if (t.name === 'forecast_volatility_window') {
      this.toolArgsJson.set('{\n  "parallelRate": 102.5,\n  "bcvRate": 75.2,\n  "currentSpreadPct": 1.5\n}');
    } else if (t.name === 'calculate_delta_neutral_hedge') {
      this.toolArgsJson.set('{\n  "vesBalance": 50000,\n  "usdtReferencePrice": 100,\n  "targetHedgePct": 100\n}');
    } else if (t.name === 'consult_zk_market_mesh') {
      this.toolArgsJson.set('{\n  "rawIdentifier": "V-12345678"\n}');
    } else {
      this.toolArgsJson.set('{\n  "simulated": true\n}');
    }
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
