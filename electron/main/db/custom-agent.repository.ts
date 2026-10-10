import type { DatabaseSync } from 'node:sqlite';

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
  skills?: string[];
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
  created_at: number;
  updated_at: number;
}

export const DEFAULT_SWARM_AGENTS: readonly CreateCustomAgentDto[] = [
  {
    id: 'arbitrage-strategist',
    name: 'Estratega Cuantitativo P2P',
    description: 'Detección de arbitraje triangular, cálculo de spreads netos y análisis de microestructura',
    systemPrompt:
      'Eres el Estratega Cuantitativo Institucional de la mesa P2P. Tu misión es detectar spreads viables mayores a la Regla de Oro (0.50% neto), analizar libros de órdenes P2P y Spot, y formular rutas operativas seguras.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.7-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
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
    id: 'security-sentinel',
    name: 'Centinela de Seguridad & Fraude',
    description: 'Auditoría OCR de comprobantes bancarios, cotejo de transferencias y reputación de contrapartes',
    systemPrompt:
      'Eres el Centinela de Seguridad y Prevención de Fraude P2P. Tu misión es verificar comprobantes de pago mediante OCR, cotejar referencias bancarias con eventos entrantes y consultar la reputación de contrapartes.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.7-flash',
    temperature: 0.0,
    isActive: true,
    executionMode: 'on_demand',
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
      'Eres el Oficial de Riesgo Bancario y Compliance SUDEBAN. Tienes poder de veto unilateral. Tu deber es evitar que las cuentas bancarias alcancen topes diarios de saturación y activar el killswitch de emergencia ante depeg o congelamientos.',
    modelProvider: 'gemini',
    modelName: 'gemini-3.7-flash',
    temperature: 0.0,
    isActive: true,
    executionMode: 'ambient_daemon',
    scheduleIntervalSec: 300,
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
    modelName: 'gemini-3.7-flash',
    temperature: 0.1,
    isActive: true,
    executionMode: 'on_demand',
    skills: [
      'compile_dispute_dossier',
      'gdrive_backup_receipt',
      'gsheets_sync_trade',
      'autofill_trade_reference',
    ],
  },
];

export class CustomAgentRepository {
  constructor(private readonly db: DatabaseSync) {}

  seedDefaultsIfEmpty(): void {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM custom_agents').get() as {
      count: number;
    };
    if (row && row.count > 0) {
      return;
    }

    for (const agent of DEFAULT_SWARM_AGENTS) {
      this.createAgent(agent);
    }
  }

  listAgents(filter?: {
    activeOnly?: boolean;
    mode?: 'on_demand' | 'ambient_daemon';
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
    const modelName = dto.modelName ?? 'gemini-3.7-flash';
    const temperature = dto.temperature ?? 0.1;
    const isActive = dto.isActive !== false ? 1 : 0;
    const executionMode = dto.executionMode ?? 'on_demand';
    const scheduleIntervalSec = dto.scheduleIntervalSec ?? null;

    this.db
      .prepare(
        `INSERT INTO custom_agents (
          id, name, description, system_prompt, model_provider, model_name,
          temperature, is_active, execution_mode, schedule_interval_sec,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const modelProvider = dto.modelProvider !== undefined ? dto.modelProvider : existing.modelProvider;
    const modelName = dto.modelName !== undefined ? dto.modelName : existing.modelName;
    const temperature = dto.temperature !== undefined ? dto.temperature : existing.temperature;
    const isActive = dto.isActive !== undefined ? (dto.isActive ? 1 : 0) : existing.isActive ? 1 : 0;
    const executionMode = dto.executionMode !== undefined ? dto.executionMode : existing.executionMode;
    const scheduleIntervalSec =
      dto.scheduleIntervalSec !== undefined ? dto.scheduleIntervalSec : (existing.scheduleIntervalSec ?? null);

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
      skills: skillRows.map((s) => s.skill_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
