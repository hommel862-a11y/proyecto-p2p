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
    id: 'ad-repricing-desk',
    name: 'Mesa de Anuncios & Repricing P2P',
    role: 'AD_REPRICING_DESK',
    avatar: '⚡',
    description:
      'Monitoreo continuo de competitividad de anuncios Binance P2P, presión de libro y propuestas HITL de repricing o pausa.',
    tools: [
      'audit_ad_competitiveness',
      'analyze_orderbook_pressure',
      'evaluate_ad_repricing',
      'recommend_competitive_pricing',
      'publish_ad_price',
      'toggle_ad_status',
    ],
    systemPromptModifier:
      'Operador de mesa de anuncios P2P. Protege spread >= 0.50% neto y exige aprobacion HITL antes de publicar cambios de precio o pausas.',
    enabled: true,
    isCustom: false,
  },
  {
    id: 'treasury-macro-cfo',
    name: 'Tesorero 360 & Centinela Macro BCV',
    role: 'TREASURY_MACRO_CFO',
    avatar: '🏦',
    description:
      'Cruce de liquidez Finanzas 360, capacidad/márgenes Cashea, ventanas de intervención BCV y rebalanceo de capital ocioso.',
    tools: [
      'f360_get_treasury_summary',
      'f360_audit_overdue_and_runway',
      'f360_analyze_cashea_capacity',
      'f360_simulate_cashea_ally_margin',
      'check_bcv_intervention_window',
      'predict_bcv_macro_regime',
      'optimize_treasury_idle_yield',
      'rebalance_capital_allocation',
    ],
    systemPromptModifier:
      'Director financiero 360 y centinela macro BCV. Protege la liquidez operativa a 14 dias y alerta antes de inyecciones cambiarias.',
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
            if (item && item.id && item.id !== 'ux-sentinel') {
              this.agents.set(item.id, item);
            }
          }
        }
      }
      this.syncFromCustomAgentTable();
    } catch (err) {
      console.warn('[AgentRegistry] Error al cargar agentes personalizados:', err);
    }
  }

  /**
   * Projects SQLite `custom_agents` (single source of truth) into the registry map
   * so Copilot mentions and Swarm routing always see the live Agent Studio fleet.
   */
  private syncFromCustomAgentTable(): void {
    if (!this.db || typeof this.db.getCustomAgentRepo !== 'function') return;
    try {
      const repo = this.db.getCustomAgentRepo();
      const rows = repo.listAgents();
      const avatarByDomain: Record<string, string> = {
        P2P_DESK: '⚡',
        FINANCE_360: '🏦',
        SECURITY: '🛡️',
        ARM_B2B: '🤝',
      };
      for (const row of rows) {
        const existing = this.agents.get(row.id);
        this.agents.set(row.id, {
          id: row.id,
          name: row.name,
          role: existing?.role ?? row.id.toUpperCase().replace(/-/g, '_'),
          avatar: existing?.avatar ?? avatarByDomain[row.domain] ?? '🤖',
          description: row.description,
          tools: row.skills,
          systemPromptModifier: row.systemPrompt,
          enabled: row.isActive,
          isCustom: existing?.isCustom ?? true,
        });
      }
    } catch (err) {
      console.warn('[AgentRegistry] Error al sincronizar desde custom_agents:', err);
    }
  }

  private persistAgents(): void {
    if (!this.db) return;
    try {
      const list = Array.from(this.agents.values()).filter((a) => a.id !== 'ux-sentinel');
      this.db.setConfigValue('copilot_registered_agents', JSON.stringify(list));
    } catch (err) {
      console.warn('[AgentRegistry] Error al guardar agentes:', err);
    }
  }

  listAgents(): RegisteredAgentDto[] {
    this.syncFromCustomAgentTable();
    return Array.from(this.agents.values()).filter((a) => a.id !== 'ux-sentinel');
  }

  getAgent(id: string): RegisteredAgentDto | undefined {
    this.syncFromCustomAgentTable();
    if (id === 'ux-sentinel') return undefined;
    return this.agents.get(id);
  }

  toggleAgent(id: string, enabled: boolean): boolean {
    this.syncFromCustomAgentTable();
    const existing = this.agents.get(id);
    if (!existing) return false;
    existing.enabled = enabled;
    if (this.db && typeof this.db.getCustomAgentRepo === 'function') {
      try {
        this.db.getCustomAgentRepo().toggleAgent(id, enabled);
      } catch {
        // Ignore if agent only exists in legacy builtin map
      }
    }
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
