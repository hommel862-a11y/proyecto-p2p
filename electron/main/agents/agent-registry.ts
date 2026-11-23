/**
 * Autonomous Agent Registry (Hermes & OpenClaw Modular Architecture).
 * Enables modular registration, runtime configuration, and activation of specialist agents.
 */

import type { P2PDatabaseService } from '../db/database';

export interface RegisteredAgentDto {
  id: string;
  name: string;
  role: string;
  avatar: string;
  description: string;
  tools: string[];
  systemPromptModifier: string;
  enabled: boolean;
  isCustom?: boolean;
}

export const DEFAULT_BUILTIN_AGENTS: RegisteredAgentDto[] = [
  {
    id: 'web-researcher',
    name: 'Investigador Web & Regulatorio',
    role: 'WEB_RESEARCHER',
    avatar: '🌐',
    description:
      'Indaga en tiempo real circulares de SUDEBAN, resoluciones del BCV, anuncios de Binance y macroeconomía con Google Search Grounding.',
    tools: ['search_google_live', 'check_bank_operational_status'],
    systemPromptModifier:
      'Especialista en investigación de hechos y regulación. Cotejá siempre con fuentes oficiales verificadas.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'corporate-cfo',
    name: 'Director Financiero & Tesorero',
    role: 'CORPORATE_CFO',
    avatar: '💼',
    description:
      'Asesoría integral en flujo de caja, balance, yield de capital ocioso en Binance Simple Earn y runway de tesorería.',
    tools: [
      'optimize_idle_capital_simple_earn',
      'calculate_earn_yield_vs_p2p_hurdle_rate',
      'optimize_locked_vs_flexible_liquidity_ladder',
      'forecast_cash_flow_and_reconciliation',
    ],
    systemPromptModifier:
      'Director financiero institucional. Minimizá costos de fricción y garantizá liquidez operativa inmediata.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'quant-strategist',
    name: 'Estratega Cuantitativo P2P',
    role: 'QUANT_STRATEGIST',
    avatar: '📐',
    description:
      'Cálculo de arbitraje triangular, cotizaciones asimétricas Avellaneda-Stoikov, métrica VPIN y slicing TWAP/VWAP.',
    tools: [
      'scan_triangular_arbitrage',
      'calculate_optimal_spread_avellaneda',
      'compute_optimal_order_slicing_twap_vwap',
      'simulate_trade_impact',
      'calculate_cross_exchange_basis_spread',
    ],
    systemPromptModifier:
      'Estratega cuantitativo de alta frecuencia. Preservación del spread neto superior a la regla de oro (0.50%).',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'risk-officer',
    name: 'Oficial de Cumplimiento & Riesgo',
    role: 'RISK_OFFICER',
    avatar: '🛡️',
    description:
      'Veto preventivo de operaciones que excedan límites SUDEBAN, cobertura Delta-Neutral contra devaluación y listas negras.',
    tools: [
      'evaluate_delta_neutral_hedge',
      'audit_zk_mesh_threat',
      'check_counterparty_blacklist',
      'optimize_capital_allocation_kelly',
    ],
    systemPromptModifier:
      'Guardián estricto de gobernanza y mitigación de devaluación y fraudes por terceros.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'dispute-auditor',
    name: 'Auditor Forense & Disputas',
    role: 'DISPUTE_AUDITOR',
    avatar: '🔍',
    description:
      'Inspección OCR de comprobantes bancarios, detección de adulteración digital y generación de expedientes de arbitraje.',
    tools: [
      'audit_payment_proof_ocr',
      'generate_dispute_dossier',
      'audit_sop_compliance_enforcement',
      'sync_google_sheets_live_ledger',
    ],
    systemPromptModifier:
      'Auditor forense transaccional. Exigí correspondencia exacta 1:1 entre titular bancario y cuenta de Binance.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'ux-sentinel',
    name: 'UX & Ergonomics Sentinel',
    role: 'UX_SENTINEL',
    avatar: '🎨',
    description:
      'Vigila la ergonomía táctil en vista 9:16 Android, áreas mínimas de 44px, fluidez a 60fps y cero desbordamientos.',
    tools: ['search_google_live'],
    systemPromptModifier:
      'Centinela y arquitecto de diseño ergonómico móvil 9:16 y experiencia de usuario limpia y minimalista.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'finance-cfo',
    name: 'CFO Virtual & Tesorería 360',
    role: 'FINANCE_CFO',
    avatar: '💼',
    description:
      'Cruce de sueldos fijos, ventas comerciales Pyme, monitoreo de cuotas Cashea Niveles 1-6 a 14 días y proyección de runway anti-quiebre.',
    tools: [
      'f360_get_treasury_summary',
      'f360_analyze_cashea_capacity',
      'f360_audit_overdue_and_runway',
      'gdrive_sync_db_backup',
      'gdrive_backup_receipt',
      'gsheets_sync_trade',
      'forecast_cash_flow_and_reconciliation',
    ],
    systemPromptModifier:
      'Director financiero y tesorero 360. Monitorea liquidez a 14 días, alerta sobre cuotas Cashea vencidas o próximas y preserva el cortafuegos de 3 gavetas.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'quote-architect',
    name: 'Cotizador & Presupuestos 360',
    role: 'QUOTE_ARCHITECT',
    avatar: '📝',
    description:
      'Cotizaciones técnicas de talleres mecánicos/latonería y obras civiles por m² con +10% de merma técnica y exportación de doble PDF prorrateado.',
    tools: [
      'f360_generate_quote_estimate',
      'f360_check_pyme_drawers_and_stock',
      'gdrive_backup_receipt',
      'gsheets_sync_trade',
    ],
    systemPromptModifier:
      'Arquitecto de presupuestos y cotizaciones técnicas. Exige anticipos que cubran el 100% de materiales y 10% de merma técnica con verificación previa de inventario.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'pyme-payroll-agent',
    name: 'Agente de Nómina y Gaveta 2',
    role: 'PYME_PAYROLL',
    avatar: '👥',
    description:
      'Audita la provisión quincenal y mensual de nómina operativa dentro de la Gaveta 2, detectando déficits de liquidez antes de la fecha de pago.',
    tools: ['f360_check_pyme_drawers_and_stock', 'f360_audit_overdue_and_runway'],
    systemPromptModifier:
      'Especialista en nómina operativa y Gaveta 2 de Pyme. Garantiza cobertura puntual de sueldos, comisiones y gastos fijos sin comprometer la Gaveta 1 de mercancía.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'pyme-providers-agent',
    name: 'Agente de Proveedores CxP y Gaveta 1',
    role: 'PYME_PROVIDERS',
    avatar: '📦',
    description:
      'Supervisa cuentas por pagar a proveedores (CxP), rotación de reposición en Gaveta 1 y conciliación con la tesorería global 360.',
    tools: ['f360_check_pyme_drawers_and_stock', 'f360_get_treasury_summary'],
    systemPromptModifier:
      'Especialista en cuentas por pagar a proveedores y Gaveta 1. Prioriza compromisos críticos de reposición y evita sobregiros de capital de trabajo.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'pyme-stock-agent',
    name: 'Agente de Inventario y Mercancía Fría',
    role: 'PYME_STOCK',
    avatar: '📊',
    description:
      'Monitorea niveles de stock crítico, detecta mercancía fría sin rotación (> 45 días) y valida disponibilidad de materiales para presupuestos.',
    tools: ['f360_check_pyme_drawers_and_stock', 'f360_generate_quote_estimate'],
    systemPromptModifier:
      'Especialista en inventario y control de mercancía fría. Identifica capital inmovilizado mayor a 45 días y respalda cotizaciones con costos actualizados.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'pyme-capex-agent',
    name: 'Agente de Utilidad, CAPEX y Cashea Aliado',
    role: 'PYME_CAPEX',
    avatar: '🏛️',
    description:
      'Evalúa márgenes netos reales en Cashea Modo Aliado (MDR, adelanto semanal y brecha cambiaria) y resguarda la utilidad retenida en Gaveta 3 (CAPEX).',
    tools: [
      'f360_simulate_cashea_ally_margin',
      'f360_check_pyme_drawers_and_stock',
      'f360_get_treasury_summary',
    ],
    systemPromptModifier:
      'Especialista en utilidad neta, reinversión CAPEX (Gaveta 3) y Cashea Modo Aliado. Calcula rentabilidad real descontando comisiones y reposición cambiaria sin recargos prohibidos.',
    enabled: true,
    isCustom: false,
  },
];

export class AgentRegistry {
  private agents: Map<string, RegisteredAgentDto> = new Map();

  constructor(private db?: P2PDatabaseService) {
    this.initDefaultAgents();
    this.loadCustomAgents();
  }

  private initDefaultAgents(): void {
    for (const agent of DEFAULT_BUILTIN_AGENTS) {
      this.agents.set(agent.id, { ...agent });
    }
  }

  private loadCustomAgents(): void {
    if (!this.db) return;
    try {
      const raw = this.db.getConfigValue('copilot_registered_agents');
      if (raw) {
        const parsed = JSON.parse(raw) as RegisteredAgentDto[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id) {
              this.agents.set(item.id, item);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[AgentRegistry] Error al cargar agentes personalizados:', err);
    }
  }

  private persistAgents(): void {
    if (!this.db) return;
    try {
      const list = Array.from(this.agents.values());
      this.db.setConfigValue('copilot_registered_agents', JSON.stringify(list));
    } catch (err) {
      console.warn('[AgentRegistry] Error al guardar agentes:', err);
    }
  }

  listAgents(): RegisteredAgentDto[] {
    return Array.from(this.agents.values());
  }

  getAgent(id: string): RegisteredAgentDto | undefined {
    return this.agents.get(id);
  }

  toggleAgent(id: string, enabled: boolean): boolean {
    const existing = this.agents.get(id);
    if (!existing) return false;
    existing.enabled = enabled;
    this.persistAgents();
    return true;
  }

  saveAgent(agent: RegisteredAgentDto): boolean {
    if (!agent || !agent.id || !agent.name) return false;
    this.agents.set(agent.id, {
      ...agent,
      isCustom: agent.isCustom ?? true,
    });
    this.persistAgents();
    return true;
  }

  deleteCustomAgent(id: string): boolean {
    const existing = this.agents.get(id);
    if (!existing || !existing.isCustom) return false;
    const deleted = this.agents.delete(id);
    if (deleted) this.persistAgents();
    return deleted;
  }
}
