import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export type AgentDomain = 'P2P_DESK' | 'FINANCE_360' | 'ARM_B2B' | 'SECURITY';
export type AgentRunTriggerType = 'daemon_tick' | 'manual_run' | 'sandbox_test' | 'copilot_mention';
export type AgentRunStatus =
  | 'running'
  | 'success'
  | 'error'
  | 'blocked_killswitch'
  | 'blocked_budget'
  | 'timeout';

export interface CustomAgentRecord {
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
  domain: AgentDomain;
  dailyBudgetUsd: number;
  maxSteps: number;
  promptVersion: number;
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
  domain?: AgentDomain;
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
  domain?: AgentDomain;
  dailyBudgetUsd?: number;
  maxSteps?: number;
  skills?: string[];
}

export interface AgentRunToolEntry {
  name: string;
  ok: boolean;
  latencyMs?: number;
  blockedReason?: string;
}

export interface AgentRunRecord {
  id: string;
  agentId: string;
  agentName?: string;
  triggerType: AgentRunTriggerType;
  status: AgentRunStatus;
  promptInput: string;
  responseOutput: string | null;
  toolsCalled: AgentRunToolEntry[];
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

export interface CreateAgentRunDto {
  id?: string;
  agentId: string;
  triggerType: AgentRunTriggerType;
  status?: AgentRunStatus;
  promptInput: string;
  modelUsed: string;
  providerUsed?: string;
  startedAt?: number;
}

export interface CompleteAgentRunDto {
  status: Exclude<AgentRunStatus, 'running'>;
  responseOutput?: string | null;
  toolsCalled?: AgentRunToolEntry[];
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  errorMessage?: string | null;
  finishedAt?: number;
}

export interface AgentRunFilter {
  agentId?: string;
  status?: AgentRunStatus;
  triggerType?: AgentRunTriggerType;
  limit?: number;
  offset?: number;
}

export interface PerAgentMetricSummary {
  agentId: string;
  runs24h: number;
  errors24h: number;
  cost24hUsd: number;
  dailyBudgetUsd: number;
  lastRunAt: number | null;
  lastRunStatus: AgentRunStatus | null;
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
  perAgent: PerAgentMetricSummary[];
}

interface RawAgentRow {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_provider: string;
  model_name: string;
  temperature: number;
  is_active: number;
  execution_mode: string;
  schedule_interval_sec: number | null;
  domain: string | null;
  daily_budget_usd: number | null;
  max_steps: number | null;
  prompt_version: number | null;
  created_at: number;
  updated_at: number;
}

interface RawAgentRunRow {
  id: string;
  agent_id: string;
  agent_name?: string | null;
  trigger_type: string;
  status: string;
  prompt_input: string;
  response_output: string | null;
  tools_called_json: string;
  model_used: string;
  provider_used: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  error_message: string | null;
  started_at: number;
  finished_at: number | null;
}

const VALID_DOMAINS = new Set<AgentDomain>(['P2P_DESK', 'FINANCE_360', 'ARM_B2B', 'SECURITY']);

function normalizeDomain(value: string | null | undefined): AgentDomain {
  if (value && VALID_DOMAINS.has(value as AgentDomain)) {
    return value as AgentDomain;
  }
  return 'P2P_DESK';
}

export const DEFAULT_SWARM_AGENTS: readonly CreateCustomAgentDto[] = [
  {
    id: 'arbitrage-strategist',
    name: 'Estratega Cuantitativo P2P',
    description: 'Detección de arbitraje triangular, cálculo de spreads netos y análisis de microestructura',
    systemPrompt:
      'Eres el Estratega Cuantitativo Institucional de la mesa P2P. Tu misión es detectar spreads viables mayores a la Regla de Oro (0.50% neto), analizar libros de órdenes P2P y Spot, y formular rutas operativas seguras sin inventar datos si falta feed en vivo.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'P2P_DESK',
    dailyBudgetUsd: 2.0,
    maxSteps: 6,
    skills: [
      'calculate_spread',
      'get_binance_p2p_orderbook',
      'get_bcv_rates',
      'get_parallel_rates',
      'calculate_rate_gap',
      'forecast_volatility_window',
      'recommend_competitive_pricing',
    ],
  },
  {
    id: 'ad-repricing-desk',
    name: 'Mesa de Anuncios & Repricing P2P',
    description:
      'Monitoreo continuo de competitividad de anuncios Binance P2P, presión de libro y propuestas HITL de ajuste de precio o pausa',
    systemPrompt:
      'Eres el Operador de Mesa de Anuncios y Repricing P2P. En ticks de fondo solo auditas competitividad y presión del libro de órdenes (READ-ONLY). Si el spread neto cae debajo de 0.50% o pierdes posición Top-3, propones un ajuste exacto o pausa que requiere aprobación humana (HITL) antes de ejecutar publish_ad_price o toggle_ad_status.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.5-flash-lite',
    temperature: 0.1,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 120,
    domain: 'P2P_DESK',
    dailyBudgetUsd: 1.5,
    maxSteps: 5,
    skills: [
      'audit_ad_competitiveness',
      'analyze_orderbook_pressure',
      'evaluate_ad_repricing',
      'recommend_competitive_pricing',
      'publish_ad_price',
      'toggle_ad_status',
    ],
  },
  {
    id: 'treasury-macro-cfo',
    name: 'Tesorero 360 & Centinela Macro BCV',
    description:
      'Cruce de liquidez Finanzas 360, capacidad y márgenes Cashea, ventanas de intervención BCV y rebalanceo de capital ocioso',
    systemPrompt:
      'Eres el Director Financiero (CFO) de Finanzas 360 y Centinela Macro BCV. Monitoreas liquidez real a 14 días, cuotas Cashea próximas o vencidas, ventanas de intervención cambiaria del BCV y rendimiento de capital ocioso. Alertas con cifras verificadas antes de que la mesa P2P quede atrapada en VES o sin capital de trabajo.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 900,
    domain: 'FINANCE_360',
    dailyBudgetUsd: 2.0,
    maxSteps: 6,
    skills: [
      'f360_get_treasury_summary',
      'f360_audit_overdue_and_runway',
      'f360_analyze_cashea_capacity',
      'f360_simulate_cashea_ally_margin',
      'check_bcv_intervention_window',
      'predict_bcv_macro_regime',
      'optimize_treasury_idle_yield',
      'rebalance_capital_allocation',
    ],
  },
  {
    id: 'security-sentinel',
    name: 'Centinela de Seguridad & Fraude',
    description: 'Auditoría OCR de comprobantes bancarios, cotejo de transferencias y reputación de contrapartes',
    systemPrompt:
      'Eres el Centinela de Seguridad y Prevención de Fraude P2P. Tu misión es verificar comprobantes de pago mediante OCR, cotejar referencias bancarias con eventos entrantes y consultar la reputación y listas negras de contrapartes.',
    modelProvider: 'gemini',
    modelName: 'gemini-4-carbon',
    temperature: 0.0,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'SECURITY',
    dailyBudgetUsd: 2.5,
    maxSteps: 6,
    skills: [
      'audit_payment_proof_ocr',
      'verify_inbound_transfer',
      'lookup_counterparty_reputation',
      'check_counterparty_blacklist',
      'screen_wallet_address',
    ],
  },
  {
    id: 'risk-gatekeeper',
    name: 'Oficial de Riesgo Bancario',
    description: 'Veto unilateral por límites SUDEBAN, saturación de cuentas y monitor de paridad USDT',
    systemPrompt:
      'Eres el Oficial de Riesgo Bancario y Compliance SUDEBAN. Tienes poder de veto unilateral. Tu deber es evitar que las cuentas bancarias alcancen topes diarios de saturación y alertar inmediatamente ante depeg de USDT o caídas bancarias.',
    modelProvider: 'gemini',
    modelName: 'gemini-4-argon',
    temperature: 0.0,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 300,
    domain: 'SECURITY',
    dailyBudgetUsd: 2.0,
    maxSteps: 5,
    skills: [
      'evaluate_account_saturation',
      'evaluate_trade_risk',
      'detect_usdt_depeg',
      'trigger_killswitch',
      'check_bank_operational_status',
    ],
  },
  {
    id: 'dispute-auditor',
    name: 'Auditor de Disputas & Conciliación',
    description: 'Compilación de expedientes de apelación para soporte y respaldo en Google Drive',
    systemPrompt:
      'Eres el Auditor Legal y de Disputas P2P. Tu función es armar expedientes forenses con pruebas de tiempo, comprobantes bancarios y chats para ganar apelaciones en Binance P2P, y respaldar recibos en Google Drive.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'SECURITY',
    dailyBudgetUsd: 1.5,
    maxSteps: 6,
    skills: [
      'compile_dispute_dossier',
      'gdrive_backup_receipt',
      'gsheets_sync_trade',
      'autofill_trade_reference',
    ],
  },
  {
    id: 'arm-router',
    name: 'Coordinador ARM (Router & Triage)',
    description: 'Clasificación de intención, sentimiento y handoff entre especialistas o control humano',
    systemPrompt:
      'Eres el Agente Coordinador (Router/Triage) de la plataforma ARM. Tu única misión es analizar el mensaje entrante, clasificar intención y sentimiento, y ejecutar route_conversation hacia SDR_QUALIFIER, QUOTER, SCHEDULER o HUMAN_TAKEOVER respetando el aislamiento del workspace_id.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'ARM_B2B',
    dailyBudgetUsd: 1.0,
    maxSteps: 4,
    skills: ['route_conversation', 'search_lead_memories'],
  },
  {
    id: 'arm-sdr-qualifier',
    name: 'Agente SDR & Calificador BANT',
    description: 'Descubrimiento consultivo BANT, extracción silenciosa de perfil y avance Zero-Click en Kanban',
    systemPrompt:
      'Eres el Especialista SDR / Calificador BANT. Realizas como máximo una pregunta abierta por turno, extraes Presupuesto, Autoridad, Necesidad y Plazo con update_lead_bant_and_profile, guardas hechos atómicos con save_lead_memory_fact y avanzas el Kanban con transition_pipeline_stage.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.3,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'ARM_B2B',
    dailyBudgetUsd: 1.0,
    maxSteps: 5,
    skills: [
      'update_lead_bant_and_profile',
      'transition_pipeline_stage',
      'save_lead_memory_fact',
      'search_lead_memories',
      'route_conversation',
    ],
  },
  {
    id: 'arm-quoter',
    name: 'Agente Cotizador & Risk Gate HITL',
    description: 'Estructuración de propuestas formales con precios oficiales de catálogo y umbral de aprobación humana',
    systemPrompt:
      'Eres el Especialista Cotizador Comercial ARM. Nunca inventas precios ni descuentos fuera del catálogo oficial. Consultas get_catalog_items y ejecutas create_or_submit_quote respetando estrictamente el Risk Gate Human-in-the-Loop.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.0,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'ARM_B2B',
    dailyBudgetUsd: 1.0,
    maxSteps: 5,
    skills: [
      'get_catalog_items',
      'create_or_submit_quote',
      'transition_pipeline_stage',
      'save_lead_memory_fact',
      'route_conversation',
    ],
  },
  {
    id: 'arm-scheduler',
    name: 'Agente Scheduler & Closer Briefing',
    description: 'Consulta de disponibilidad en zona horaria IANA del cliente, reserva de demo y briefing para el closer',
    systemPrompt:
      'Eres el Especialista de Agenda (Scheduler) ARM. Verificas horarios reales con check_calendar_slots antes de ofrecer horas, confirmas correo y zona horaria del prospecto y ejecutas book_appointment generando el briefing_for_human.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.8-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    domain: 'ARM_B2B',
    dailyBudgetUsd: 1.0,
    maxSteps: 5,
    skills: ['check_calendar_slots', 'book_appointment', 'transition_pipeline_stage', 'route_conversation'],
  },
  {
    id: 'arm-followup-daemon',
    name: 'Daemon Anti-Ghosting & Reactivación HSM',
    description: 'Escaneo horario de prospectos inactivos (>24h/72h) y encolado de plantillas HSM contextuales',
    systemPrompt:
      'Eres el Agente FOLLOW_UP de Reactivación Proactiva ARM. Escaneas prospectos estancados cuya ventana gratuita de 24h de Meta expiró, recuperas su dolor principal con search_lead_memories y encolas send_whatsapp_template en la bandeja de aprobación.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.5-flash-lite',
    temperature: 0.2,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 3600,
    domain: 'ARM_B2B',
    dailyBudgetUsd: 1.0,
    maxSteps: 4,
    skills: ['send_whatsapp_template', 'search_lead_memories', 'save_lead_memory_fact'],
  },
];

export class CustomAgentRepository {
  constructor(private readonly db: DatabaseSync) {}

  seedDefaultsIfEmpty(): void {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM custom_agents').get() as {
      count: number;
    };
    if (row && row.count > 0) {
      // Ensure new core agents (e.g. ad-repricing-desk, treasury-macro-cfo) are added on upgrade
      this.ensureCoreAgents(['ad-repricing-desk', 'treasury-macro-cfo']);
      return;
    }

    for (const agent of DEFAULT_SWARM_AGENTS) {
      this.createAgent(agent);
    }
  }

  ensureCoreAgents(ids: string[]): void {
    for (const targetId of ids) {
      if (this.getAgentById(targetId)) continue;
      const spec = DEFAULT_SWARM_AGENTS.find((a) => a.id === targetId);
      if (spec) {
        this.createAgent(spec);
      }
    }
  }

  listAgents(filter?: {
    activeOnly?: boolean;
    mode?: 'on_demand' | 'ambient_daemon';
    domain?: AgentDomain;
  }): CustomAgentRecord[] {
    let sql = 'SELECT * FROM custom_agents WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.activeOnly) {
      sql += ' AND is_active = 1';
    }
    if (filter?.mode) {
      sql += ' AND execution_mode = ?';
      params.push(filter.mode);
    }
    if (filter?.domain) {
      sql += ' AND domain = ?';
      params.push(filter.domain);
    }

    sql += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(sql).all(...params) as unknown as RawAgentRow[];
    return rows.map((r) => this.mapAgentWithSkills(r));
  }

  getAgentById(id: string): CustomAgentRecord | null {
    const row = this.db
      .prepare('SELECT * FROM custom_agents WHERE id = ?')
      .get(id) as unknown as RawAgentRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapAgentWithSkills(row);
  }

  createAgent(dto: CreateCustomAgentDto): CustomAgentRecord {
    const now = Date.now();
    const id = dto.id && dto.id.trim() ? dto.id.trim() : `agent-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const name = dto.name.trim();
    const description = (dto.description ?? '').trim();
    const systemPrompt = dto.systemPrompt.trim();
    const modelProvider = dto.modelProvider ?? 'gemini';
    const modelName = dto.modelName ?? 'gemini-3.8-flash';
    const temperature = dto.temperature ?? 0.1;
    const isActive = dto.isActive !== false ? 1 : 0;
    const executionMode = dto.executionMode ?? 'on_demand';
    const scheduleIntervalSec =
      executionMode === 'ambient_daemon' ? Math.max(60, dto.scheduleIntervalSec ?? 300) : (dto.scheduleIntervalSec ?? null);
    const domain = normalizeDomain(dto.domain);
    const dailyBudgetUsd = Math.max(0.05, Number(dto.dailyBudgetUsd ?? 1.5));
    const maxSteps = Math.max(1, Math.min(20, Math.round(dto.maxSteps ?? 6)));

    this.db
      .prepare(
        `INSERT INTO custom_agents (
          id, name, description, system_prompt, model_provider, model_name,
          temperature, is_active, execution_mode, schedule_interval_sec,
          domain, daily_budget_usd, max_steps, prompt_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        name,
        description,
        systemPrompt,
        modelProvider,
        modelName,
        temperature,
        isActive,
        executionMode,
        scheduleIntervalSec,
        domain,
        dailyBudgetUsd,
        maxSteps,
        now,
        now,
      );

    const skills = dto.skills ?? [];
    if (skills.length > 0) {
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO custom_agent_skills (agent_id, skill_id, created_at) VALUES (?, ?, ?)',
      );
      for (const skill of skills) {
        if (skill && skill.trim()) {
          stmt.run(id, skill.trim(), now);
        }
      }
    }

    const created = this.getAgentById(id);
    if (!created) {
      throw new Error(`Failed to retrieve newly created agent: ${id}`);
    }
    return created;
  }

  updateAgent(id: string, dto: UpdateCustomAgentDto): CustomAgentRecord | null {
    const existing = this.getAgentById(id);
    if (!existing) {
      return null;
    }

    const now = Date.now();
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const description = dto.description !== undefined ? dto.description.trim() : existing.description;
    const systemPrompt = dto.systemPrompt !== undefined ? dto.systemPrompt.trim() : existing.systemPrompt;
    const promptChanged = dto.systemPrompt !== undefined && systemPrompt !== existing.systemPrompt;
    const promptVersion = promptChanged ? existing.promptVersion + 1 : existing.promptVersion;
    const modelProvider = dto.modelProvider !== undefined ? dto.modelProvider : existing.modelProvider;
    const modelName = dto.modelName !== undefined ? dto.modelName : existing.modelName;
    const temperature = dto.temperature !== undefined ? dto.temperature : existing.temperature;
    const isActive = dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : existing.isActive ? 1 : 0;
    const executionMode = dto.executionMode !== undefined ? dto.executionMode : existing.executionMode;
    const rawInterval =
      dto.scheduleIntervalSec !== undefined ? dto.scheduleIntervalSec : (existing.scheduleIntervalSec ?? null);
    const scheduleIntervalSec =
      executionMode === 'ambient_daemon' && rawInterval !== null ? Math.max(60, rawInterval) : rawInterval;
    const domain = dto.domain !== undefined ? normalizeDomain(dto.domain) : existing.domain;
    const dailyBudgetUsd =
      dto.dailyBudgetUsd !== undefined ? Math.max(0.05, Number(dto.dailyBudgetUsd)) : existing.dailyBudgetUsd;
    const maxSteps =
      dto.maxSteps !== undefined ? Math.max(1, Math.min(20, Math.round(dto.maxSteps))) : existing.maxSteps;

    this.db
      .prepare(
        `UPDATE custom_agents SET
          name = ?,
          description = ?,
          system_prompt = ?,
          model_provider = ?,
          model_name = ?,
          temperature = ?,
          is_active = ?,
          execution_mode = ?,
          schedule_interval_sec = ?,
          domain = ?,
          daily_budget_usd = ?,
          max_steps = ?,
          prompt_version = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        name,
        description,
        systemPrompt,
        modelProvider,
        modelName,
        temperature,
        isActive,
        executionMode,
        scheduleIntervalSec,
        domain,
        dailyBudgetUsd,
        maxSteps,
        promptVersion,
        now,
        id,
      );

    if (dto.skills !== undefined) {
      this.db.prepare('DELETE FROM custom_agent_skills WHERE agent_id = ?').run(id);
      const stmt = this.db.prepare(
        'INSERT OR IGNORE INTO custom_agent_skills (agent_id, skill_id, created_at) VALUES (?, ?, ?)',
      );
      for (const skill of dto.skills) {
        if (skill && skill.trim()) {
          stmt.run(id, skill.trim(), now);
        }
      }
    }

    return this.getAgentById(id);
  }

  deleteAgent(id: string): boolean {
    const res = this.db.prepare('DELETE FROM custom_agents WHERE id = ?').run(id);
    return (res.changes ?? 0) > 0;
  }

  toggleAgent(id: string, active?: boolean): CustomAgentRecord | null {
    const existing = this.getAgentById(id);
    if (!existing) {
      return null;
    }
    const newActive = active !== undefined ? active : !existing.isActive;
    return this.updateAgent(id, { isActive: newActive });
  }

  // ── Forensic Runs Ledger (`agent_runs`) ────────────────────────────────────

  createRun(dto: CreateAgentRunDto): AgentRunRecord {
    const id = dto.id && dto.id.trim() ? dto.id.trim() : `run-${crypto.randomUUID().slice(0, 12)}`;
    const startedAt = dto.startedAt ?? Date.now();
    const status = dto.status ?? 'running';
    const providerUsed = dto.providerUsed ?? 'gemini';

    this.db
      .prepare(
        `INSERT INTO agent_runs (
          id, agent_id, trigger_type, status, prompt_input, response_output,
          tools_called_json, model_used, provider_used, tokens_in, tokens_out,
          cost_usd, latency_ms, error_message, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, ?, 0, 0, 0, 0, NULL, ?, NULL)`,
      )
      .run(id, dto.agentId, dto.triggerType, status, dto.promptInput, dto.modelUsed, providerUsed, startedAt);

    const created = this.getRunById(id);
    if (!created) {
      throw new Error(`Failed to retrieve newly created agent run: ${id}`);
    }
    return created;
  }

  completeRun(id: string, dto: CompleteAgentRunDto): AgentRunRecord | null {
    const existing = this.getRunById(id);
    if (!existing) return null;

    const finishedAt = dto.finishedAt ?? Date.now();
    const latencyMs = dto.latencyMs ?? Math.max(0, finishedAt - existing.startedAt);
    const toolsJson = JSON.stringify(dto.toolsCalled ?? existing.toolsCalled);

    this.db
      .prepare(
        `UPDATE agent_runs SET
          status = ?,
          response_output = ?,
          tools_called_json = ?,
          tokens_in = ?,
          tokens_out = ?,
          cost_usd = ?,
          latency_ms = ?,
          error_message = ?,
          finished_at = ?
        WHERE id = ?`,
      )
      .run(
        dto.status,
        dto.responseOutput ?? null,
        toolsJson,
        dto.tokensIn ?? 0,
        dto.tokensOut ?? 0,
        dto.costUsd ?? 0,
        latencyMs,
        dto.errorMessage ?? null,
        finishedAt,
        id,
      );

    return this.getRunById(id);
  }

  getRunById(id: string): AgentRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT r.*, a.name AS agent_name
         FROM agent_runs r
         LEFT JOIN custom_agents a ON a.id = r.agent_id
         WHERE r.id = ?`,
      )
      .get(id) as unknown as RawAgentRunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRuns(filter?: AgentRunFilter): AgentRunRecord[] {
    let sql = `SELECT r.*, a.name AS agent_name
               FROM agent_runs r
               LEFT JOIN custom_agents a ON a.id = r.agent_id
               WHERE 1=1`;
    const params: (string | number)[] = [];

    if (filter?.agentId) {
      sql += ' AND r.agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.status) {
      sql += ' AND r.status = ?';
      params.push(filter.status);
    }
    if (filter?.triggerType) {
      sql += ' AND r.trigger_type = ?';
      params.push(filter.triggerType);
    }

    const limit = Math.max(1, Math.min(500, Math.round(filter?.limit ?? 100)));
    const offset = Math.max(0, Math.round(filter?.offset ?? 0));
    sql += ' ORDER BY r.started_at DESC, r.rowid DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as unknown as RawAgentRunRow[];
    return rows.map((r) => this.mapRun(r));
  }

  getAgentDailySpendUsd(agentId: string, nowMs = Date.now()): number {
    const since = nowMs - 24 * 60 * 60 * 1000;
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
         FROM agent_runs
         WHERE agent_id = ? AND started_at >= ?`,
      )
      .get(agentId, since) as { total_cost: number } | undefined;
    return Number(row?.total_cost ?? 0);
  }

  getFleetMetrics(nowMs = Date.now()): AgentFleetMetricsDto {
    const since = nowMs - 24 * 60 * 60 * 1000;
    const agents = this.listAgents();
    const totalAgents = agents.length;
    const activeAgents = agents.filter((a) => a.isActive).length;
    const activeDaemons = agents.filter((a) => a.isActive && a.executionMode === 'ambient_daemon').length;

    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) AS runs_24h,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_24h,
           SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) AS errors_24h,
           SUM(CASE WHEN status IN ('blocked_killswitch', 'blocked_budget') THEN 1 ELSE 0 END) AS blocked_24h,
           COALESCE(SUM(cost_usd), 0) AS total_cost_24h,
           COALESCE(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS avg_latency_24h
         FROM agent_runs
         WHERE started_at >= ?`,
      )
      .get(since) as {
      runs_24h: number;
      success_24h: number | null;
      errors_24h: number | null;
      blocked_24h: number | null;
      total_cost_24h: number;
      avg_latency_24h: number;
    };

    const runs24h = Number(totals?.runs_24h ?? 0);
    const success24h = Number(totals?.success_24h ?? 0);
    const errors24h = Number(totals?.errors_24h ?? 0);
    const blocked24h = Number(totals?.blocked_24h ?? 0);
    const successRate24hPct = runs24h > 0 ? Number(((success24h / runs24h) * 100).toFixed(1)) : 100;

    const perAgentRows = this.db
      .prepare(
        `SELECT
           agent_id,
           COUNT(*) AS runs_24h,
           SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) AS errors_24h,
           COALESCE(SUM(cost_usd), 0) AS cost_24h,
           COALESCE(AVG(CASE WHEN latency_ms > 0 THEN latency_ms END), 0) AS avg_latency_ms
         FROM agent_runs
         WHERE started_at >= ?
         GROUP BY agent_id`,
      )
      .all(since) as Array<{
      agent_id: string;
      runs_24h: number;
      errors_24h: number | null;
      cost_24h: number;
      avg_latency_ms: number;
    }>;

    const statsMap = new Map(perAgentRows.map((r) => [r.agent_id, r]));
    const lastRunStmt = this.db.prepare(
      `SELECT started_at, status FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    );

    const perAgent: PerAgentMetricSummary[] = agents.map((agent) => {
      const s = statsMap.get(agent.id);
      const last = lastRunStmt.get(agent.id) as { started_at: number; status: string } | undefined;
      return {
        agentId: agent.id,
        runs24h: Number(s?.runs_24h ?? 0),
        errors24h: Number(s?.errors_24h ?? 0),
        cost24hUsd: Number(s?.cost_24h ?? 0),
        dailyBudgetUsd: agent.dailyBudgetUsd,
        lastRunAt: last?.started_at ?? null,
        lastRunStatus: (last?.status as AgentRunStatus | undefined) ?? null,
        avgLatencyMs: Math.round(Number(s?.avg_latency_ms ?? 0)),
      };
    });

    return {
      totalAgents,
      activeAgents,
      activeDaemons,
      runs24h,
      success24h,
      errors24h,
      blocked24h,
      successRate24hPct,
      totalCost24hUsd: Number(Number(totals?.total_cost_24h ?? 0).toFixed(6)),
      avgLatency24hMs: Math.round(Number(totals?.avg_latency_24h ?? 0)),
      perAgent,
    };
  }

  private mapAgentWithSkills(row: RawAgentRow): CustomAgentRecord {
    const skillRows = this.db
      .prepare('SELECT skill_id FROM custom_agent_skills WHERE agent_id = ? ORDER BY skill_id ASC')
      .all(row.id) as { skill_id: string }[];

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      systemPrompt: row.system_prompt,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      temperature: row.temperature,
      isActive: row.is_active === 1,
      executionMode: (row.execution_mode as 'on_demand' | 'ambient_daemon') ?? 'on_demand',
      scheduleIntervalSec: row.schedule_interval_sec ?? undefined,
      domain: normalizeDomain(row.domain),
      dailyBudgetUsd: Number(row.daily_budget_usd ?? 1.5),
      maxSteps: Number(row.max_steps ?? 6),
      promptVersion: Number(row.prompt_version ?? 1),
      skills: skillRows.map((s) => s.skill_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRun(row: RawAgentRunRow): AgentRunRecord {
    let toolsCalled: AgentRunToolEntry[] = [];
    try {
      const parsed = JSON.parse(row.tools_called_json);
      if (Array.isArray(parsed)) {
        toolsCalled = parsed as AgentRunToolEntry[];
      }
    } catch {
      toolsCalled = [];
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name ?? undefined,
      triggerType: row.trigger_type as AgentRunTriggerType,
      status: row.status as AgentRunStatus,
      promptInput: row.prompt_input,
      responseOutput: row.response_output,
      toolsCalled,
      modelUsed: row.model_used,
      providerUsed: row.provider_used,
      tokensIn: Number(row.tokens_in ?? 0),
      tokensOut: Number(row.tokens_out ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
      latencyMs: Number(row.latency_ms ?? 0),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}
