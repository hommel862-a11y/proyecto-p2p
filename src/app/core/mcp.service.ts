import { Injectable, signal, computed } from '@angular/core';
import type { McpStatusDto, McpServerRuntimeInfo, McpAuditLogDto } from '../../../electron/shared/types';

export const FALLBACK_MCP_SERVERS: McpServerRuntimeInfo[] = [
  {
    id: 'p2p-decisor',
    name: 'P2P Decisor — Gateway Maestro',
    category: 'master',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 8,
    resourceCount: 5,
    uptimeSeconds: 3600,
    tools: [
      { name: 'calculate_spread', description: 'Calcula el spread bruto, comisiones deducibles y spread neto porcentual.' },
      { name: 'evaluate_trade_risk', description: 'Evalúa la propuesta contra las 6 reglas institucionales de control de capital.' },
      { name: 'simulate_trade_impact', description: 'Simula el impacto de la orden en la liquidez y límites diarios.' },
      { name: 'consult_zk_market_mesh', description: 'Consulta listas negras federadas con hashes ciegos (Zero-Knowledge).' },
      { name: 'forecast_volatility_window', description: 'Predice dinámica de spread a 2h con ciclos de intervención del BCV.' },
      { name: 'calculate_delta_neutral_hedge', description: 'Calcula la cobertura corta sintética para inventarios en bolívares.' },
      { name: 'trigger_killswitch', description: 'Detiene inmediatamente todas las operaciones (Human-in-the-Loop).' },
      { name: 'add_operation_entry', description: 'Asienta una nueva operación en el Ledger contable (Human-in-the-Loop).' },
    ],
    resources: [
      { uri: 'p2p://risk/live-status', name: 'Estado del Kill-Switch y Modo Seguro' },
      { uri: 'p2p://risk/rules', name: 'Catálogo de Reglas Institucionales' },
      { uri: 'p2p://ledger/recent', name: 'Últimas Operaciones del Ledger' },
      { uri: 'p2p://market/cotizave/rates', name: 'Tasas Oficiales y Brecha CotizaVe' },
      { uri: 'p2p://risk/zk-mesh/stats', name: 'Estadísticas de la Red Federada ZK' },
    ],
  },
  {
    id: 'p2p-rates-venezuela',
    name: 'Monitor de Tasas y Dólar Local 🇻🇪',
    category: 'tasas',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 4,
    resourceCount: 2,
    uptimeSeconds: 3600,
    tools: [
      { name: 'get_bcv_rates', description: 'Tasas oficiales BCV (USD, EUR) y fecha de valor efectiva.' },
      { name: 'get_parallel_rates', description: 'Cotizaciones de EnParaleloVzla, CotizaVe y CriptoNoticias.' },
      { name: 'calculate_rate_gap', description: 'Brecha oficial vs. paralelo y riesgo de distorsión cambiaria.' },
      { name: 'check_bcv_intervention_window', description: 'Estado de la ventana de subastas del BCV (09:00 - 13:00 VET).' },
    ],
    resources: [
      { uri: 'p2p://rates/live', name: 'Cotizaciones en Vivo' },
      { uri: 'p2p://rates/gap-history', name: 'Historial de Brecha Cambiaria' },
    ],
  },
  {
    id: 'p2p-crypto-market',
    name: 'Datos de Mercado Cripto en Vivo 📈',
    category: 'mercado',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 4,
    resourceCount: 2,
    uptimeSeconds: 3600,
    tools: [
      { name: 'get_binance_p2p_orderbook', description: 'Profundidad en vivo del libro P2P de Binance para VES/USDT.' },
      { name: 'detect_usdt_depeg', description: 'Detección de despegue de paridad de USDT (< 0.998 o > 1.002).' },
      { name: 'recommend_competitive_pricing', description: 'Precios óptimos para situarse en el Top 3 con margen objetivo.' },
      { name: 'analyze_orderbook_pressure', description: 'Presión compradora vs vendedora a nivel de microestructura.' },
    ],
    resources: [
      { uri: 'p2p://market/binance-p2p/depth', name: 'Profundidad del Libro P2P' },
      { uri: 'p2p://market/spot/volatility', name: 'Volatilidad Spot Global' },
    ],
  },
  {
    id: 'p2p-portfolio-risk',
    name: 'Gestión de Portafolio y Riesgo 🛡️',
    category: 'portafolio',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 4,
    resourceCount: 2,
    uptimeSeconds: 3600,
    tools: [
      { name: 'get_consolidated_liquidity', description: 'Balance en bancos (Banesco, Pago Móvil, Zelle, Binance Pay).' },
      { name: 'evaluate_bank_concentration', description: 'Alerta de sobreexposición (> 70% en un solo canal financiero).' },
      { name: 'calculate_inflation_adjusted_roi', description: 'Rendimiento financiero neto ajustado por devaluación.' },
      { name: 'structure_delta_neutral_hedge', description: 'Estructuración de coberturas cortas para inventarios fiat.' },
    ],
    resources: [
      { uri: 'p2p://portfolio/balances', name: 'Saldos Consolidados por Banco' },
      { uri: 'p2p://portfolio/concentration-report', name: 'Matriz de Concentración' },
    ],
  },
  {
    id: 'p2p-ledger-analytics',
    name: 'Inteligencia Transaccional y Auditoría 📊',
    category: 'ledger',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 4,
    resourceCount: 2,
    uptimeSeconds: 3600,
    tools: [
      { name: 'query_ledger_analytics', description: 'Consultas analíticas en lenguaje natural sobre el historial contable.' },
      { name: 'audit_cancellation_hotspots', description: 'Análisis de patrones en órdenes canceladas o disputadas.' },
      { name: 'calculate_commission_drag', description: 'Impacto acumulado de comisiones de exchange y bancos en el PnL.' },
      { name: 'export_audit_dossier', description: 'Dossier forense conciliado para justificación bancaria.' },
    ],
    resources: [
      { uri: 'p2p://ledger/kpi-summary', name: 'Métricas Mensuales Acumuladas' },
      { uri: 'p2p://ledger/disputes', name: 'Historial de Resoluciones de Disputas' },
    ],
  },
];

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

  readonly onlineCount = computed(() =>
    this.servers().filter((s) => s.status === 'ONLINE').length,
  );

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

  async testTool(toolName: string, args: unknown): Promise<{ success: boolean; result?: unknown; error?: string; executionTimeMs: number }> {
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

    return {
      success: true,
      result: {
        toolName,
        status: 'OK',
        simulated: true,
        args,
        message: `Ejecución de prueba completada en ${executionTimeMs} ms.`,
      },
      executionTimeMs,
    };
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
