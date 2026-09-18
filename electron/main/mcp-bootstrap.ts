import path from 'node:path';
import type { McpStatusDto, McpServerRuntimeInfo, McpAuditLogDto } from '../shared/types';
import { refreshFinancialSkillMarketData } from './gemini-skills';

export interface McpBootstrapStatus {
  enabled: boolean;
  started: boolean;
  startTime: number;
  totalCalls: number;
  error?: string;
}

let mcpStatus: McpBootstrapStatus = {
  enabled: false,
  started: false,
  startTime: Date.now(),
  totalCalls: 0,
};

let inMemoryAuditLogs: McpAuditLogDto[] = [];
let activeServerInstance: any = null;

/**
 * Static catalog metadata of the 4 strategic categories plus the master server.
 */
export const MCP_SERVER_REGISTRY: McpServerRuntimeInfo[] = [
  {
    id: 'p2p-decisor',
    name: 'P2P Decisor — Gateway Maestro',
    category: 'master',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 8,
    resourceCount: 5,
    uptimeSeconds: 0,
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
    id: 'p2p-aml-forensics',
    name: 'AML & On-Chain Forensics 🔍',
    category: 'seguridad',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 4,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'screen_wallet_address', description: 'Evalúa el riesgo AML on-chain de una dirección cripto (TRC20, ERC20, BEP20).' },
      { name: 'inspect_tx_taint', description: 'Inspecciona el grado de contaminación y saltos a mixers en hashes blockchain.' },
      { name: 'check_counterparty_blacklist', description: 'Consulta listas negras locales SQLite por cédula, teléfono o cuenta ante estafas de triangulación.' },
      { name: 'register_blacklisted_entity', description: 'Registra entidades sospechosas o fraudulentas en la lista negra local (Human-in-the-Loop).' },
    ],
    resources: [
      { uri: 'p2p://aml/sanctions-db', name: 'Base de Billeteras y Direcciones Sancionadas' },
      { uri: 'p2p://aml/taint-thresholds', name: 'Umbrales Institucionales de Contaminación' },
    ],
  },
  {
    id: 'p2p-multi-exchange',
    name: 'Multi-Exchange P2P & Arbitraje 🌐',
    category: 'mercado',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 5,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'get_binance_p2p_orderbook', description: 'Profundidad en vivo del libro P2P de Binance para VES/USDT.' },
      { name: 'fetch_cross_exchange_spread', description: 'Compara precios P2P en tiempo real entre Binance, Bybit, OKX y KuCoin.' },
      { name: 'detect_usdt_depeg', description: 'Detección de despegue de paridad de USDT (< 0.998 o > 1.002).' },
      { name: 'recommend_competitive_pricing', description: 'Precios óptimos para situarse en el Top 3 con margen objetivo.' },
      { name: 'analyze_orderbook_pressure', description: 'Presión compradora vs vendedora a nivel de microestructura.' },
    ],
    resources: [
      { uri: 'p2p://market/cross-exchange/depth', name: 'Profundidad Multi-Mercado Unificada' },
      { uri: 'p2p://market/arbitrage-matrix', name: 'Matriz de Oportunidades Cruzadas' },
    ],
  },
  {
    id: 'p2p-bank-sentinel',
    name: 'Conciliación Bancaria & Webhook 🏦',
    category: 'bancos',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 3,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'verify_inbound_transfer', description: 'Concilia instantáneamente transferencias o PagoMóvil verificando referencia y monto.' },
      { name: 'check_bank_operational_status', description: 'Monitorea en tiempo real fallas bancarias locales y emite órdenes de PAUSA preventiva.' },
      { name: 'audit_payment_proof_ocr', description: 'Audita comprobantes de pago mediante OCR y verifica titularidad y monto exacto contra la orden.' },
    ],
    resources: [
      { uri: 'p2p://banking/clearing-feed', name: 'Cámara de Compensación y Pagos Entrantes' },
      { uri: 'p2p://banking/accounts-status', name: 'Disponibilidad de Canales Bancarios' },
    ],
  },
  {
    id: 'p2p-dispute-dossier',
    name: 'Dossier Forense & Apelaciones AI ⚖️',
    category: 'legal',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 1,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'compile_dispute_dossier', description: 'Genera un expediente forense en PDF con sellos SHA-256 para ganar apelaciones.' },
    ],
    resources: [
      { uri: 'p2p://legal/appeal-templates', name: 'Plantillas de Argumentación Legal P2P' },
      { uri: 'p2p://legal/dispute-archive', name: 'Historial de Apelaciones Resueltas' },
    ],
  },
  {
    id: 'p2p-sudeban-radar',
    name: 'Radar Anti-SUDEBAN & Velocidad 🛡️',
    category: 'compliance',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 1,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'evaluate_account_saturation', description: 'Monitorea la velocidad transaccional y cupos bancarios para prevenir bloqueos.' },
    ],
    resources: [
      { uri: 'p2p://compliance/sudeban-limits', name: 'Límites Regulatorios y Circulares Vigentes' },
      { uri: 'p2p://compliance/account-scores', name: 'Scoring de Salud de Cuentas Bancarias' },
    ],
  },
  {
    id: 'p2p-portfolio-risk',
    name: 'Gestión de Portafolio & Coberturas 💼',
    category: 'portafolio',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 5,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'calculate_delta_neutral_hedge', description: 'Calcula la cobertura corta sintética para inventarios en bolívares.' },
      { name: 'stress_test_portfolio', description: 'Simula escenarios de devaluación y caída de solvencia.' },
      { name: 'rebalance_capital_allocation', description: 'Distribución óptima de capital entre operadores y prevención de pitufeo.' },
      { name: 'audit_counterparty_exposure', description: 'Audita concentración por contraparte y patrones de triangulación.' },
      { name: 'project_compound_runway', description: 'Proyección de crecimiento con interés compuesto y límites bancarios.' },
    ],
    resources: [
      { uri: 'p2p://portfolio/stress-scenarios', name: 'Escenarios de Stress Testing' },
      { uri: 'p2p://portfolio/allocation', name: 'Distribución de Capital' },
    ],
  },
  {
    id: 'p2p-omnichannel',
    name: 'Concierge Omnicanal & OTC 💬',
    category: 'operaciones',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 3,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'dispatch_order_instructions', description: 'Despacha coordenadas bancarias e instrucciones seguras vía Telegram o WhatsApp.' },
      { name: 'send_multichannel_alert', description: 'Despacha alertas proactivas a Telegram/WhatsApp con botones interactivos.' },
      { name: 'process_remote_sentinel_command', description: 'Procesa instrucciones de texto o voz asentando compras/ventas directamente en el Ledger.' },
    ],
    resources: [
      { uri: 'p2p://omnichannel/active-chats', name: 'Sesiones de Chat con Contrapartes VIP' },
      { uri: 'p2p://omnichannel/dispatch-logs', name: 'Bitácora de Notificaciones Enviadas' },
    ],
  },
  {
    id: 'p2p-macro-predictor',
    name: 'Monitor Macro & Dólar Venezuela 🇻🇪',
    category: 'tasas',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 5,
    resourceCount: 3,
    uptimeSeconds: 0,
    tools: [
      { name: 'get_bcv_rates', description: 'Tasas oficiales BCV (USD, EUR) y fecha de valor efectiva.' },
      { name: 'get_parallel_rates', description: 'Cotizaciones de EnParaleloVzla, CotizaVe y CriptoNoticias.' },
      { name: 'calculate_rate_gap', description: 'Brecha oficial vs. paralelo y riesgo de distorsión cambiaria.' },
      { name: 'check_bcv_intervention_window', description: 'Estado de la ventana de subastas del BCV (09:00 - 13:00 VET).' },
      { name: 'autofill_trade_reference', description: 'Precio sugerido de apertura optimizado según punto medio y margen.' },
    ],
    resources: [
      { uri: 'p2p://rates/bcv', name: 'Tasas Oficiales BCV' },
      { uri: 'p2p://rates/parallel', name: 'Monitores Paralelos Consolidados' },
      { uri: 'p2p://rates/gap-analysis', name: 'Análisis de Brecha y Ciclo BCV' },
    ],
  },
  {
    id: 'p2p-google-workspace',
    name: 'Google Workspace & Cloud Vault ☁️',
    category: 'cloud',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 3,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'gdrive_backup_receipt', description: 'Respalda y organiza comprobantes de pago escaneados en Google Drive.' },
      { name: 'gsheets_sync_trade', description: 'Sincroniza una operación del Ledger en tiempo real en Google Sheets.' },
      { name: 'gdrive_sync_db_backup', description: 'Genera y respalda un snapshot contable en Google Drive.' },
    ],
    resources: [
      { uri: 'p2p://cloud/gdrive/receipts', name: 'Directorio de Comprobantes en Drive' },
      { uri: 'p2p://cloud/gsheets/ledger', name: 'Hoja Maestra de Operaciones P2P' },
    ],
  },
  {
    id: 'p2p-counterparty-mesh',
    name: 'Inteligencia ZK & Lista Negra 🛡️',
    category: 'seguridad',
    status: 'ONLINE',
    transport: 'stdio',
    toolCount: 2,
    resourceCount: 2,
    uptimeSeconds: 0,
    tools: [
      { name: 'consult_zk_market_mesh', description: 'Consulta listas negras federadas con hashes ciegos (Zero-Knowledge).' },
      { name: 'lookup_counterparty_reputation', description: 'Consulta reputación y antecedentes de fraude de cédulas/cuentas.' },
    ],
    resources: [
      { uri: 'p2p://mesh/reputation-index', name: 'Índice de Reputación Federada ZK' },
      { uri: 'p2p://mesh/blacklist-feed', name: 'Lista Negra Consensuada' },
    ],
  },
];

/**
 * Initializes the embedded P2P MCP server if MCP_ENABLED=1 or --enable-mcp flag is passed.
 * Does not block Electron application startup if disabled or fails.
 */
export async function bootstrapMcpServer(): Promise<McpBootstrapStatus> {
  const isEnabled = process.env['MCP_ENABLED'] === '1' || process.argv.includes('--enable-mcp');
  mcpStatus.enabled = isEnabled;

  if (!isEnabled) {
    return mcpStatus;
  }

  try {
    const mcpDistPath = path.resolve(__dirname, '../../../packages/mcp-server/dist/index.js');
    const fileUrl = new URL(`file:///${mcpDistPath.replace(/\\/g, '/')}`).href;

    const importEsm = new Function('specifier', 'return import(specifier)');
    const mcpModule = await importEsm(fileUrl);

    if (mcpModule && typeof mcpModule.createP2PMcpServer === 'function') {
      activeServerInstance = mcpModule.createP2PMcpServer();
      mcpStatus.started = Boolean(activeServerInstance);
      mcpStatus.startTime = Date.now();
      console.log('🚀 [MCP Bootstrap] P2P MCP Server successfully initialized inside Electron.');
      // Alimenta el caché de datos en vivo que consumen los skills financieros
      // síncronos de gemini-skills (misma fuente Binance C2C del server embebido).
      // Fire-and-forget: nunca bloquea ni revienta el arranque.
      void refreshFinancialSkillMarketData()
        .then((r) => console.log(`📡 [MCP Bootstrap] ${r.message}`))
        .catch(() => undefined);
    } else {
      throw new Error('createP2PMcpServer not found in bundle');
    }
    return mcpStatus;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('⚠️ [MCP Bootstrap] Could not initialize embedded MCP server:', msg);
    mcpStatus.error = msg;
    return mcpStatus;
  }
}

export function getMcpStatus(): McpBootstrapStatus {
  return mcpStatus;
}

export function getMcpFullStatus(): McpStatusDto {
  const now = Date.now();
  const uptimeSeconds = Math.floor((now - mcpStatus.startTime) / 1000);

  const servers = MCP_SERVER_REGISTRY.map((s) => ({
    ...s,
    status: (mcpStatus.started || process.env['NODE_ENV'] !== 'production' ? 'ONLINE' : 'STANDBY') as 'ONLINE' | 'STANDBY',
    uptimeSeconds,
  }));

  return {
    servers,
    recentAuditLogs: inMemoryAuditLogs.slice(-20),
    totalCallsServed: mcpStatus.totalCalls,
    activeTransport: 'stdio',
  };
}

export async function executeMcpToolTest(
  toolName: string,
  args: unknown,
): Promise<{ success: boolean; result?: unknown; error?: string; executionTimeMs: number }> {
  const start = Date.now();
  mcpStatus.totalCalls += 1;

  try {
    process.env['MCP_EMBEDDED_IMPORT'] = 'true';
    const mcpDistPath = path.resolve(__dirname, '../../../packages/mcp-server/dist/index.js');
    const fileUrl = new URL(`file:///${mcpDistPath.replace(/\\/g, '/')}`).href;
    const importEsm = new Function('specifier', 'return import(specifier)');
    const mcpModule = await importEsm(fileUrl);

    const tools: Array<{ name: string; inputSchema: { parse: (input: unknown) => unknown }; execute: (input: unknown) => unknown }> =
      mcpModule.ALL_MCP_TOOLS || [];

    const matchedTool = tools.find((t) => t.name === toolName);
    if (!matchedTool) {
      throw new Error(`Herramienta "${toolName}" no encontrada en el catálogo MCP compilado.`);
    }

    // Validate with real Zod schema and execute pure domain engine
    const validatedArgs = matchedTool.inputSchema.parse(args);
    const realResult = await Promise.resolve(matchedTool.execute(validatedArgs));
    const elapsed = Date.now() - start;

    const logEntry: McpAuditLogDto = {
      timestamp: new Date().toISOString(),
      toolName,
      inputHash: Buffer.from(JSON.stringify(args || {})).toString('base64').substring(0, 16),
      outputHash: Buffer.from(JSON.stringify(realResult || {})).toString('base64').substring(0, 16),
      success: true,
    };
    inMemoryAuditLogs.push(logEntry);

    return {
      success: true,
      result: realResult,
      executionTimeMs: elapsed,
    };
  } catch (err: unknown) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    inMemoryAuditLogs.push({
      timestamp: new Date().toISOString(),
      toolName,
      inputHash: 'err',
      outputHash: 'err',
      success: false,
      error: msg,
    });
    return {
      success: false,
      error: msg,
      executionTimeMs: elapsed,
    };
  }
}

