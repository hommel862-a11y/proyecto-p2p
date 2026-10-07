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
