import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { app } from 'electron';
import type { FsmOrderContext, P2POrderState } from '../../shared/types';

export interface InboundBankEventRecord {
  id?: number;
  bank: string;
  reference: string;
  payerName?: string;
  payerIdDoc?: string;
  amountFiat: number;
  rawText?: string;
  status?: 'PENDING' | 'MATCHED' | 'DUPLICATE' | 'DISPUTED' | 'DISCARDED';
  matchedOrderId?: string;
  receivedAt?: number;
}

export interface StrategyPlanRecord {
  id: string;
  title: string;
  route: string;
  asset?: string;
  fiat?: string;
  capitalRequiredUsdt: number;
  expectedNetSpreadPct: number;
  expectedProfitUsdt: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  assignedOperatorId?: string;
  assignedOperatorName?: string;
  rationale: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';
  createdAt: number;
  updatedAt: number;
}

export interface MarketLearningRecord {
  id?: number;
  topicKey: string;
  category: 'SPREAD_CYCLE' | 'BCV_IMPACT' | 'OPERATOR_PERFORMANCE' | 'COUNTERPARTY_BEHAVIOR' | 'TRIANGULATION_ROUTE';
  insight: string;
  confidenceScore?: number;
  sampleCount?: number;
  dataPayload?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export interface EngramObservationRecord {
  id?: number;
  topicKey: string;
  type: 'discovery' | 'decision' | 'architecture' | 'pattern' | 'bugfix' | 'preference';
  scope?: 'project' | 'personal';
  what: string;
  why: string;
  whereAffected: string;
  learned: string;
  confidenceScore?: number;
  sampleCount?: number;
  status?: 'active' | 'needs_review';
  createdAt?: number;
  updatedAt?: number;
}

export interface BlacklistEntryRecord {
  id?: number;
  identifierType: 'CEDULA' | 'PHONE' | 'ACCOUNT_NUMBER' | 'BINANCE_ALIAS';
  identifierValue: string;
  counterpartyName?: string;
  fraudCategory: 'TRIANGULATION_SCAM' | 'THIRD_PARTY_PAYER' | 'CHARGEBACK_ATTEMPT' | 'IDENTITY_THEFT' | 'OTHER';
  incidentNotes?: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  reportedAt: number;
}

export class P2PDatabaseService {
  private db: DatabaseSync;

  constructor(dbFilePath?: string) {
    let targetPath = dbFilePath;
    if (!targetPath) {
      try {
        const userDataPath = app.getPath('userData');
        targetPath = path.join(userDataPath, 'antigravity_p2p.sqlite');
      } catch {
        // Fallback for tests or environments where app is not available
        targetPath = path.resolve(__dirname, '../../../../antigravity_p2p.sqlite');
      }
    }

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(targetPath);
    this.initPragmas();
    this.applySchema();
  }

  private initPragmas(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  private applySchema(): void {
    const schemaPath = path.resolve(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      this.db.exec(sql);
    } else {
      // Fallback inline bootstrap if schema.sql is not in same relative directory at runtime
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS p2p_orders (
          order_id TEXT PRIMARY KEY,
          side TEXT NOT NULL,
          asset TEXT NOT NULL DEFAULT 'USDT',
          fiat TEXT NOT NULL DEFAULT 'VES',
          amount_crypto REAL NOT NULL,
          amount_fiat REAL NOT NULL,
          price REAL NOT NULL,
          counterparty_name TEXT NOT NULL,
          counterparty_id_doc TEXT,
          current_state TEXT NOT NULL,
          bank_payment_json TEXT,
          fraud_score REAL,
          flags_json TEXT,
          history_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS inbound_bank_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dedup_hash TEXT UNIQUE NOT NULL,
          bank TEXT NOT NULL,
          reference TEXT NOT NULL,
          payer_name TEXT,
          payer_id_doc TEXT,
          amount_fiat REAL NOT NULL,
          raw_text TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          matched_order_id TEXT,
          received_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fsm_audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id TEXT NOT NULL,
          from_state TEXT NOT NULL,
          to_state TEXT NOT NULL,
          event TEXT NOT NULL,
          reason TEXT,
          timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS strategy_plans (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          route TEXT NOT NULL,
          asset TEXT NOT NULL DEFAULT 'USDT',
          fiat TEXT NOT NULL DEFAULT 'VES',
          capital_required_usdt REAL NOT NULL,
          expected_net_spread_pct REAL NOT NULL,
          expected_profit_usdt REAL NOT NULL,
          risk_level TEXT NOT NULL,
          assigned_operator_id TEXT,
          assigned_operator_name TEXT,
          rationale TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PROPOSED',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS market_learnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_key TEXT NOT NULL,
          category TEXT NOT NULL,
          insight TEXT NOT NULL,
          confidence_score REAL NOT NULL DEFAULT 1.0,
          sample_count INTEGER NOT NULL DEFAULT 1,
          data_payload_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS engram_observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_key TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'discovery',
          scope TEXT NOT NULL DEFAULT 'project',
          what TEXT NOT NULL,
          why TEXT NOT NULL,
          where_affected TEXT NOT NULL,
          learned TEXT NOT NULL,
          confidence_score REAL NOT NULL DEFAULT 1.0,
          sample_count INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    }

    // Explicit migration guard: guarantee critical tables and indexes exist on any pre-existing database
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engram_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_key TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'discovery' CHECK (type IN ('discovery', 'decision', 'architecture', 'pattern', 'bugfix', 'preference')),
        scope TEXT NOT NULL DEFAULT 'project',
        what TEXT NOT NULL,
        why TEXT NOT NULL,
        where_affected TEXT NOT NULL,
        learned TEXT NOT NULL,
        confidence_score REAL NOT NULL DEFAULT 1.0,
        sample_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_review')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_engram_topic ON engram_observations(topic_key);
      CREATE INDEX IF NOT EXISTS idx_engram_type ON engram_observations(type);
      CREATE INDEX IF NOT EXISTS idx_engram_status ON engram_observations(status);
      CREATE INDEX IF NOT EXISTS idx_engram_updated ON engram_observations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS counterparty_profiles (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        real_name TEXT NOT NULL,
        document_id TEXT,
        phone TEXT,
        reputation TEXT NOT NULL DEFAULT 'NORMAL' CHECK (reputation IN ('TRUSTED', 'VERIFIED', 'NORMAL', 'SUSPICIOUS', 'BLOCKED')),
        risk_score REAL NOT NULL DEFAULT 0.0,
        successful_trades_count INTEGER NOT NULL DEFAULT 0,
        triangulation_incidents_count INTEGER NOT NULL DEFAULT 0,
        total_volume_usdt REAL NOT NULL DEFAULT 0.0,
        notes TEXT,
        last_trade_timestamp INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cparty_alias ON counterparty_profiles(alias);
      CREATE INDEX IF NOT EXISTS idx_cparty_doc ON counterparty_profiles(document_id);
      CREATE INDEX IF NOT EXISTS idx_cparty_rep ON counterparty_profiles(reputation);

      CREATE TABLE IF NOT EXISTS counterparty_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identifier_type TEXT NOT NULL CHECK (identifier_type IN ('CEDULA', 'PHONE', 'ACCOUNT_NUMBER', 'BINANCE_ALIAS')),
        identifier_value TEXT NOT NULL,
        counterparty_name TEXT,
        fraud_category TEXT NOT NULL CHECK (fraud_category IN ('TRIANGULATION_SCAM', 'THIRD_PARTY_PAYER', 'CHARGEBACK_ATTEMPT', 'IDENTITY_THEFT', 'OTHER')),
        incident_notes TEXT,
        risk_level TEXT NOT NULL DEFAULT 'CRITICAL' CHECK (risk_level IN ('CRITICAL', 'HIGH', 'MEDIUM')),
        reported_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bl_type_val ON counterparty_blacklist(identifier_type, identifier_value);
      CREATE INDEX IF NOT EXISTS idx_bl_val ON counterparty_blacklist(identifier_value);
    `);
  }

  /**
   * Persists or updates an FSM Order record.
   */
  saveOrder(order: FsmOrderContext): void {
    const stmt = this.db.prepare(`
      INSERT INTO p2p_orders (
        order_id, side, asset, fiat, amount_crypto, amount_fiat, price,
        counterparty_name, counterparty_id_doc, current_state,
        bank_payment_json, fraud_score, flags_json, history_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        side = excluded.side,
        asset = excluded.asset,
        fiat = excluded.fiat,
        amount_crypto = excluded.amount_crypto,
        amount_fiat = excluded.amount_fiat,
        price = excluded.price,
        counterparty_name = excluded.counterparty_name,
        counterparty_id_doc = excluded.counterparty_id_doc,
        current_state = excluded.current_state,
        bank_payment_json = excluded.bank_payment_json,
        fraud_score = excluded.fraud_score,
        flags_json = excluded.flags_json,
        history_json = excluded.history_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      order.orderId,
      order.side,
      order.asset,
      order.fiat,
      order.amountCrypto,
      order.amountFiat,
      order.price,
      order.counterpartyName,
      order.counterpartyIdDoc ?? null,
      order.currentState,
      order.bankPayment ? JSON.stringify(order.bankPayment) : null,
      order.fraudScore ?? null,
      JSON.stringify(order.flags),
      JSON.stringify(order.history),
      order.createdAt,
      order.updatedAt,
    );
  }

  /**
   * Retrieves an order by its ID.
   */
  getOrder(orderId: string): FsmOrderContext | null {
    const stmt = this.db.prepare(`SELECT * FROM p2p_orders WHERE order_id = ?`);
    const row = stmt.get(orderId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      orderId: row['order_id'] as string,
      side: row['side'] as 'BUY' | 'SELL',
      asset: row['asset'] as string,
      fiat: row['fiat'] as string,
      amountCrypto: Number(row['amount_crypto']),
      amountFiat: Number(row['amount_fiat']),
      price: Number(row['price']),
      counterpartyName: row['counterparty_name'] as string,
      counterpartyIdDoc: (row['counterparty_id_doc'] as string) || undefined,
      currentState: row['current_state'] as P2POrderState,
      bankPayment: row['bank_payment_json']
        ? (JSON.parse(row['bank_payment_json'] as string) as FsmOrderContext['bankPayment'])
        : undefined,
      fraudScore: row['fraud_score'] !== null ? Number(row['fraud_score']) : undefined,
      flags: row['flags_json'] ? (JSON.parse(row['flags_json'] as string) as string[]) : [],
      history: row['history_json'] ? (JSON.parse(row['history_json'] as string) as FsmOrderContext['history']) : [],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  /**
   * Lists all active (non-terminal) orders for memory reconstruction on startup.
   */
  listActiveOrders(): FsmOrderContext[] {
    const stmt = this.db.prepare(`
      SELECT * FROM p2p_orders 
      WHERE current_state NOT IN ('COMPLETED', 'DISPUTED', 'CANCELLED')
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      orderId: row['order_id'] as string,
      side: row['side'] as 'BUY' | 'SELL',
      asset: row['asset'] as string,
      fiat: row['fiat'] as string,
      amountCrypto: Number(row['amount_crypto']),
      amountFiat: Number(row['amount_fiat']),
      price: Number(row['price']),
      counterpartyName: row['counterparty_name'] as string,
      counterpartyIdDoc: (row['counterparty_id_doc'] as string) || undefined,
      currentState: row['current_state'] as P2POrderState,
      bankPayment: row['bank_payment_json']
        ? (JSON.parse(row['bank_payment_json'] as string) as FsmOrderContext['bankPayment'])
        : undefined,
      fraudScore: row['fraud_score'] !== null ? Number(row['fraud_score']) : undefined,
      flags: row['flags_json'] ? (JSON.parse(row['flags_json'] as string) as string[]) : [],
      history: row['history_json'] ? (JSON.parse(row['history_json'] as string) as FsmOrderContext['history']) : [],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }));
  }

  /**
   * Ingests an inbound bank event and enforces 30-day idempotency/deduplication.
   */
  recordInboundBankEvent(event: InboundBankEventRecord): { isDuplicate: boolean; eventId: number } {
    const cleanBank = event.bank.trim().toLowerCase();
    const cleanRef = event.reference.trim();
    const dedupRaw = `${cleanBank}:${cleanRef}:${event.amountFiat.toFixed(2)}`;
    const dedupHash = crypto.createHash('sha256').update(dedupRaw).digest('hex');
    const receivedAt = event.receivedAt ?? Date.now();

    // Comprobar ventana de 30 días
    const thirtyDaysAgo = receivedAt - 30 * 24 * 60 * 60 * 1000;
    const checkStmt = this.db.prepare(`
      SELECT id FROM inbound_bank_events
      WHERE (dedup_hash = ? OR (lower(bank) = ? AND reference = ?))
        AND received_at >= ?
      LIMIT 1
    `);
    const existing = checkStmt.get(dedupHash, cleanBank, cleanRef, thirtyDaysAgo) as { id: number } | undefined;

    if (existing) {
      return { isDuplicate: true, eventId: existing.id };
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO inbound_bank_events (
        dedup_hash, bank, reference, payer_name, payer_id_doc,
        amount_fiat, raw_text, status, matched_order_id, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      dedupHash,
      event.bank,
      event.reference,
      event.payerName ?? null,
      event.payerIdDoc ?? null,
      event.amountFiat,
      event.rawText ?? null,
      event.status ?? 'PENDING',
      event.matchedOrderId ?? null,
      receivedAt,
    );

    // Obtener ID generado
    const lastIdStmt = this.db.prepare(`SELECT last_insert_rowid() as id`);
    const result = lastIdStmt.get() as { id: number };

    return { isDuplicate: false, eventId: result.id };
  }

  /**
   * Appends an immutable audit log entry for FSM transitions.
   */
  logFsmTransition(audit: {
    orderId: string;
    fromState: string;
    toState: string;
    event: string;
    reason?: string;
    timestamp: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO fsm_audit_log (order_id, from_state, to_state, event, reason, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(audit.orderId, audit.fromState, audit.toState, audit.event, audit.reason ?? null, audit.timestamp);
  }

  /**
   * Persists or updates a StrategyPlanRecord.
   */
  saveStrategyPlan(plan: StrategyPlanRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO strategy_plans (
        id, title, route, asset, fiat, capital_required_usdt,
        expected_net_spread_pct, expected_profit_usdt, risk_level,
        assigned_operator_id, assigned_operator_name, rationale,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        route = excluded.route,
        asset = excluded.asset,
        fiat = excluded.fiat,
        capital_required_usdt = excluded.capital_required_usdt,
        expected_net_spread_pct = excluded.expected_net_spread_pct,
        expected_profit_usdt = excluded.expected_profit_usdt,
        risk_level = excluded.risk_level,
        assigned_operator_id = excluded.assigned_operator_id,
        assigned_operator_name = excluded.assigned_operator_name,
        rationale = excluded.rationale,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      plan.id,
      plan.title,
      plan.route,
      plan.asset ?? 'USDT',
      plan.fiat ?? 'VES',
      plan.capitalRequiredUsdt,
      plan.expectedNetSpreadPct,
      plan.expectedProfitUsdt,
      plan.riskLevel,
      plan.assignedOperatorId ?? null,
      plan.assignedOperatorName ?? null,
      plan.rationale,
      plan.status,
      plan.createdAt,
      plan.updatedAt,
    );
  }

  /**
   * Retrieves a strategy plan by ID.
   */
  getStrategyPlan(planId: string): StrategyPlanRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM strategy_plans WHERE id = ?`);
    const row = stmt.get(planId) as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
      id: row['id'] as string,
      title: row['title'] as string,
      route: row['route'] as string,
      asset: row['asset'] as string,
      fiat: row['fiat'] as string,
      capitalRequiredUsdt: Number(row['capital_required_usdt']),
      expectedNetSpreadPct: Number(row['expected_net_spread_pct']),
      expectedProfitUsdt: Number(row['expected_profit_usdt']),
      riskLevel: row['risk_level'] as StrategyPlanRecord['riskLevel'],
      assignedOperatorId: (row['assigned_operator_id'] as string) || undefined,
      assignedOperatorName: (row['assigned_operator_name'] as string) || undefined,
      rationale: row['rationale'] as string,
      status: row['status'] as StrategyPlanRecord['status'],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  /**
   * Lists strategy plans ordered by created_at DESC.
   */
  listStrategyPlans(limit = 20): StrategyPlanRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM strategy_plans ORDER BY created_at DESC LIMIT ?`);
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row['id'] as string,
      title: row['title'] as string,
      route: row['route'] as string,
      asset: row['asset'] as string,
      fiat: row['fiat'] as string,
      capitalRequiredUsdt: Number(row['capital_required_usdt']),
      expectedNetSpreadPct: Number(row['expected_net_spread_pct']),
      expectedProfitUsdt: Number(row['expected_profit_usdt']),
      riskLevel: row['risk_level'] as StrategyPlanRecord['riskLevel'],
      assignedOperatorId: (row['assigned_operator_id'] as string) || undefined,
      assignedOperatorName: (row['assigned_operator_name'] as string) || undefined,
      rationale: row['rationale'] as string,
      status: row['status'] as StrategyPlanRecord['status'],
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }));
  }

  /**
   * Updates status of a strategy plan.
   */
  updateStrategyPlanStatus(planId: string, status: StrategyPlanRecord['status']): boolean {
    const stmt = this.db.prepare(`
      UPDATE strategy_plans SET status = ?, updated_at = ? WHERE id = ?
    `);
    const res = stmt.run(status, Date.now(), planId);
    return res.changes > 0;
  }

  /**
   * Records a market learning insight into SQLite.
   */
  recordMarketLearning(learning: MarketLearningRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO market_learnings (
        topic_key, category, insight, confidence_score, sample_count,
        data_payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    stmt.run(
      learning.topicKey,
      learning.category,
      learning.insight,
      learning.confidenceScore ?? 1.0,
      learning.sampleCount ?? 1,
      learning.dataPayload ? JSON.stringify(learning.dataPayload) : null,
      learning.createdAt ?? now,
      learning.updatedAt ?? now,
    );

    const lastId = (this.db.prepare(`SELECT last_insert_rowid() as id`).get() as { id: number }).id;

    // Mirror into Engram Persistent Memory protocol
    try {
      this.saveEngramObservation({
        topicKey: learning.topicKey,
        type: 'discovery',
        scope: 'project',
        what: learning.insight,
        why: `Observación de mercado categorizada como ${learning.category}`,
        whereAffected: learning.topicKey,
        learned: learning.insight,
        confidenceScore: learning.confidenceScore,
        sampleCount: learning.sampleCount,
        status: 'active',
        createdAt: learning.createdAt ?? now,
        updatedAt: learning.updatedAt ?? now,
      });
    } catch {
      // Non-fatal if mirror fails
    }

    return lastId;
  }

  /**
   * Lists market learnings by optional category.
   */
  listMarketLearnings(category?: string, limit = 50): MarketLearningRecord[] {
    let stmt;
    let rows: Array<Record<string, unknown>>;
    if (category) {
      stmt = this.db.prepare(`
        SELECT * FROM market_learnings WHERE category = ? ORDER BY updated_at DESC LIMIT ?
      `);
      rows = stmt.all(category, limit) as Array<Record<string, unknown>>;
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM market_learnings ORDER BY updated_at DESC LIMIT ?
      `);
      rows = stmt.all(limit) as Array<Record<string, unknown>>;
    }

    return rows.map((row) => ({
      id: Number(row['id']),
      topicKey: row['topic_key'] as string,
      category: row['category'] as MarketLearningRecord['category'],
      insight: row['insight'] as string,
      confidenceScore: Number(row['confidence_score']),
      sampleCount: Number(row['sample_count']),
      dataPayload: row['data_payload_json'] ? JSON.parse(row['data_payload_json'] as string) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }));
  }

  /**
   * Persists an Engram memory observation to SQLite following the mandatory Engram Protocol.
   */
  saveEngramObservation(obs: EngramObservationRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO engram_observations (
        topic_key, type, scope, what, why, where_affected, learned,
        confidence_score, sample_count, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    stmt.run(
      obs.topicKey,
      obs.type,
      obs.scope ?? 'project',
      obs.what,
      obs.why,
      obs.whereAffected,
      obs.learned,
      obs.confidenceScore ?? 1.0,
      obs.sampleCount ?? 1,
      obs.status ?? 'active',
      obs.createdAt ?? now,
      obs.updatedAt ?? now,
    );

    const lastId = this.db.prepare(`SELECT last_insert_rowid() as id`).get() as { id: number };
    return lastId.id;
  }

  /**
   * Retrieves Engram memory observations with optional filters.
   */
  listEngramObservations(
    filter?: { topicKey?: string; type?: string; status?: string },
    limit = 50,
  ): EngramObservationRecord[] {
    let query = 'SELECT * FROM engram_observations';
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter?.topicKey) {
      conditions.push('topic_key = ?');
      params.push(filter.topicKey);
    }
    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row['id']),
      topicKey: row['topic_key'] as string,
      type: row['type'] as EngramObservationRecord['type'],
      scope: (row['scope'] as EngramObservationRecord['scope']) ?? 'project',
      what: row['what'] as string,
      why: row['why'] as string,
      whereAffected: row['where_affected'] as string,
      learned: row['learned'] as string,
      confidenceScore: Number(row['confidence_score']),
      sampleCount: Number(row['sample_count']),
      status: (row['status'] as EngramObservationRecord['status']) ?? 'active',
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    }));
  }

  /**
   * Formats active Engram observations as a structured markdown memory block for AI context.
   */
  getEngramContextSummary(limit = 5): string {
    const observations = this.listEngramObservations({ status: 'active' }, limit);
    if (observations.length === 0) {
      return '';
    }

    return observations
      .map((obs) => {
        return `[ENGRAM MEMORY | topic: ${obs.topicKey} | type: ${obs.type} | conf: ${((obs.confidenceScore ?? 1) * 100).toFixed(0)}%]\n` +
          `• What: ${obs.what}\n` +
          `• Why: ${obs.why}\n` +
          `• Where: ${obs.whereAffected}\n` +
          `• Learned: ${obs.learned}`;
      })
      .join('\n\n');
  }

  /**
   * Reads a key-value configuration item from SQLite.
   */
  getConfigValue(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM app_config_kv WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Writes a key-value configuration item to SQLite.
   */
  setConfigValue(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO app_config_kv (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(key, value, Date.now());
  }

  /**
   * Adds an entry to the local SQLite counterparty blacklist.
   */
  addBlacklistEntry(entry: BlacklistEntryRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO counterparty_blacklist (
        identifier_type, identifier_value, counterparty_name,
        fraud_category, incident_notes, risk_level, reported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      entry.identifierType,
      entry.identifierValue.trim(),
      entry.counterpartyName ?? null,
      entry.fraudCategory,
      entry.incidentNotes ?? null,
      entry.riskLevel ?? 'CRITICAL',
      entry.reportedAt || Date.now()
    );
    return Number(res.lastInsertRowid);
  }

  /**
   * Searches for any matches in the local counterparty blacklist by cédula, phone, account number, or alias.
   */
  findBlacklistMatches(query: {
    cedula?: string;
    phone?: string;
    accountNumber?: string;
    alias?: string;
  }): BlacklistEntryRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (query.cedula?.trim()) {
      conditions.push("(identifier_type = 'CEDULA' AND identifier_value = ?)");
      params.push(query.cedula.trim());
    }
    if (query.phone?.trim()) {
      conditions.push("(identifier_type = 'PHONE' AND identifier_value = ?)");
      params.push(query.phone.trim());
    }
    if (query.accountNumber?.trim()) {
      conditions.push("(identifier_type = 'ACCOUNT_NUMBER' AND identifier_value = ?)");
      params.push(query.accountNumber.trim());
    }
    if (query.alias?.trim()) {
      conditions.push("(identifier_type = 'BINANCE_ALIAS' AND LOWER(identifier_value) = LOWER(?))");
      params.push(query.alias.trim());
    }

    if (conditions.length === 0) {
      return [];
    }

    const sql = `SELECT * FROM counterparty_blacklist WHERE ${conditions.join(' OR ')} ORDER BY reported_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row['id']),
      identifierType: row['identifier_type'] as BlacklistEntryRecord['identifierType'],
      identifierValue: row['identifier_value'] as string,
      counterpartyName: (row['counterparty_name'] as string) ?? undefined,
      fraudCategory: row['fraud_category'] as BlacklistEntryRecord['fraudCategory'],
      incidentNotes: (row['incident_notes'] as string) ?? undefined,
      riskLevel: row['risk_level'] as BlacklistEntryRecord['riskLevel'],
      reportedAt: Number(row['reported_at']),
    }));
  }

  /**
   * Lists recent blacklist records with an optional limit.
   */
  listBlacklistEntries(limit = 50): BlacklistEntryRecord[] {
    const stmt = this.db.prepare('SELECT * FROM counterparty_blacklist ORDER BY reported_at DESC LIMIT ?');
    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row['id']),
      identifierType: row['identifier_type'] as BlacklistEntryRecord['identifierType'],
      identifierValue: row['identifier_value'] as string,
      counterpartyName: (row['counterparty_name'] as string) ?? undefined,
      fraudCategory: row['fraud_category'] as BlacklistEntryRecord['fraudCategory'],
      incidentNotes: (row['incident_notes'] as string) ?? undefined,
      riskLevel: row['risk_level'] as BlacklistEntryRecord['riskLevel'],
      reportedAt: Number(row['reported_at']),
    }));
  }

  close(): void {
    this.db.close();
  }
}
