import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { app } from 'electron';
import type {
  CopilotThreadDto,
  CopilotThreadMessageDto,
  CopilotUsageSummaryDto,
  EngramReviewResult,
  FsmOrderContext,
  P2POrderState,
  ProvenanceMetadata,
  ToolCallTrace,
} from '../../shared/types';
import {
  SqliteDecisionJournalRepository,
  purgeMarketSnapshotsBefore,
  listMarketSnapshots,
} from './decision-journal.repository';
import type {
  DecisionJournalRepository,
  MarketSnapshot,
  MarketSnapshotsFilter,
} from './decision-journal.repository';
import { CustomAgentRepository } from './custom-agent.repository';
import { ArmRepository } from './arm.repository';
import { Finance360Repository } from './finance360.repository';

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
  /**
   * Whether the plan's numbers came from a live feed. Persisted so dispatch can
   * refuse simulated plans. Undefined on legacy rows, treated as simulated.
   */
  esSimulado?: boolean;
  isSimulated?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MarketLearningRecord {
  id?: number;
  topicKey: string;
  category:
    | 'SPREAD_CYCLE'
    | 'BCV_IMPACT'
    | 'OPERATOR_PERFORMANCE'
    | 'COUNTERPARTY_BEHAVIOR'
    | 'TRIANGULATION_ROUTE';
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
  fraudCategory:
    'TRIANGULATION_SCAM' | 'THIRD_PARTY_PAYER' | 'CHARGEBACK_ATTEMPT' | 'IDENTITY_THEFT' | 'OTHER';
  incidentNotes?: string;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  reportedAt: number;
}

export interface AuditEventRecord {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  details?: string;
  severity: string;
  createdAt: number;
}

export interface OperationRecord {
  id: string;
  timestamp: string;
  side: string;
  fiatAmount: number;
  cryptoAmount: number;
  price: number;
  bank: string;
  reference?: string;
  counterparty?: string;
  status: string;
  rawJson: string;
  createdAt: number;
}

export interface BankAccountRecord {
  id: string;
  bankName: string;
  bankCode: string;
  rail: 'PAGO_MOVIL' | 'TRANSFERENCIA' | 'MIXTO';
  accountNumberMasked: string;
  dailyLimitVes: number;
  monthlyLimitVes?: number;
  initialBalanceVes: number;
  status?: 'ACTIVE' | 'DISABLED';
  maxDailyTransactions?: number;
  createdAt?: number;
  updatedAt?: number;
}

export class P2PDatabaseService {
  private db: DatabaseSync;
  /**
   * Lazily created and cached: the adapter is stateless apart from the cycle-id
   * sequence, so one instance per connection keeps ids monotonic and lets callers
   * rely on `getDecisionJournal()` returning the same object.
   */
  private decisionJournal: DecisionJournalRepository | null = null;
  private customAgentRepo: CustomAgentRepository | null = null;
  private armRepo: ArmRepository | null = null;
  private finance360Repo: Finance360Repository | null = null;

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
          -- Provenance of the numbers. Persisted so executePlan can refuse to
          -- dispatch a plan whose figures came from reference values instead of
          -- a live feed. Absent on legacy rows, which are treated as simulated.
          es_simulated INTEGER NOT NULL DEFAULT 1,
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

    // Column migration: strategy_plans gains es_simulated. CREATE TABLE IF NOT
    // EXISTS does not add columns to an existing table, so an already-created
    // database needs this explicit ALTER. Legacy rows default to 1 (simulated),
    // which fails closed at the dispatch gate.
    const planCols = this.db.prepare(`PRAGMA table_info(strategy_plans)`).all() as {
      name: string;
    }[];
    if (planCols.length > 0 && !planCols.some((c) => c.name === 'es_simulated')) {
      this.db.exec(
        `ALTER TABLE strategy_plans ADD COLUMN es_simulated INTEGER NOT NULL DEFAULT 1`,
      );
    }

    // Column migration: market_snapshots gains optional macro context columns (btc_usdt, sol_usdt, usdc_usdt, bcv_ves).
    const snapCols = this.db.prepare(`PRAGMA table_info(market_snapshots)`).all() as {
      name: string;
    }[];
    if (snapCols.length > 0) {
      const existingSnapCols = new Set(snapCols.map((c) => c.name));
      for (const col of ['btc_usdt', 'sol_usdt', 'usdc_usdt', 'bcv_ves']) {
        if (!existingSnapCols.has(col)) {
          this.db.exec(`ALTER TABLE market_snapshots ADD COLUMN ${col} REAL`);
        }
      }
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

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);

      CREATE TABLE IF NOT EXISTS operation_records (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        side TEXT NOT NULL,
        fiat_amount REAL NOT NULL,
        crypto_amount REAL NOT NULL,
        price REAL NOT NULL,
        bank TEXT NOT NULL,
        reference TEXT,
        counterparty TEXT,
        status TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_op_records_time ON operation_records(created_at DESC);

      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        bank_name TEXT NOT NULL,
        bank_code TEXT NOT NULL,
        rail TEXT NOT NULL CHECK (rail IN ('PAGO_MOVIL', 'TRANSFERENCIA', 'MIXTO')),
        account_number_masked TEXT NOT NULL,
        daily_limit_ves REAL NOT NULL DEFAULT 0,
        monthly_limit_ves REAL DEFAULT 0,
        initial_balance_ves REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
        max_daily_transactions INTEGER DEFAULT 15,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bank_accounts_status ON bank_accounts(status);
      CREATE INDEX IF NOT EXISTS idx_bank_accounts_code ON bank_accounts(bank_code);

      CREATE TABLE IF NOT EXISTS custom_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        system_prompt TEXT NOT NULL,
        model_provider TEXT NOT NULL DEFAULT 'gemini',
        model_name TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
        temperature REAL NOT NULL DEFAULT 0.1,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        execution_mode TEXT NOT NULL DEFAULT 'on_demand' CHECK (execution_mode IN ('on_demand', 'ambient_daemon')),
        schedule_interval_sec INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_custom_agents_active ON custom_agents(is_active);
      CREATE INDEX IF NOT EXISTS idx_custom_agents_mode ON custom_agents(execution_mode);

      CREATE TABLE IF NOT EXISTS custom_agent_skills (
        agent_id TEXT NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, skill_id)
      );
      CREATE INDEX IF NOT EXISTS idx_custom_agent_skills_agent ON custom_agent_skills(agent_id);

      CREATE TABLE IF NOT EXISTS copilot_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_threads_updated ON copilot_threads(pinned DESC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS copilot_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES copilot_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        provenance_json TEXT,
        tool_traces_json TEXT,
        plan_id TEXT,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_messages_thread ON copilot_messages(thread_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS copilot_usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        cached INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_copilot_usage_created ON copilot_usage_ledger(created_at DESC);

      CREATE TABLE IF NOT EXISTS arm_leads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        full_name TEXT,
        company_name TEXT,
        phone_whatsapp TEXT,
        email TEXT,
        current_stage_slug TEXT NOT NULL,
        assigned_agent_role TEXT,
        qualification_score INTEGER NOT NULL DEFAULT 0 CHECK (qualification_score BETWEEN 0 AND 100),
        bant_json TEXT NOT NULL DEFAULT '{}',
        ai_executive_summary TEXT,
        estimated_deal_value REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_leads_workspace_stage ON arm_leads(workspace_id, current_stage_slug);

      CREATE TABLE IF NOT EXISTS arm_approval_queue (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        idempotency_key TEXT UNIQUE NOT NULL,
        lead_id TEXT NOT NULL,
        requested_by_role TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        title TEXT NOT NULL,
        agent_reasoning TEXT NOT NULL,
        risk_rule_triggered TEXT NOT NULL,
        proposed_payload_json TEXT NOT NULL,
        final_approved_payload_json TEXT,
        save_as_example INTEGER NOT NULL DEFAULT 0 CHECK (save_as_example IN (0, 1)),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'EDITED_AND_APPROVED', 'REJECTED', 'EXPIRED')),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_approval_workspace_status ON arm_approval_queue(workspace_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS arm_outbox_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        event_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_outbox_cursor ON arm_outbox_events(workspace_id, id ASC);

      CREATE TABLE IF NOT EXISTS arm_shadow_examples (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        agent_role TEXT NOT NULL,
        action_type TEXT NOT NULL,
        proposed_text TEXT NOT NULL,
        approved_text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_shadow_workspace_role ON arm_shadow_examples(workspace_id, agent_role);

      CREATE TABLE IF NOT EXISTS arm_bank_rails (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        bank_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        holder_details TEXT,
        current_balance_fiat REAL NOT NULL DEFAULT 0,
        max_daily_cap_fiat REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'AVAILABLE',
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_bank_rails_workspace_status ON arm_bank_rails(workspace_id, status);

      CREATE TABLE IF NOT EXISTS arm_payment_receipts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL CHECK (workspace_id IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        bank_rail_id TEXT NOT NULL,
        reference_code TEXT NOT NULL,
        amount_fiat REAL NOT NULL DEFAULT 0,
        deal_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (workspace_id, bank_rail_id, reference_code)
      );
      CREATE INDEX IF NOT EXISTS idx_arm_payment_receipts_workspace_created ON arm_payment_receipts(workspace_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS arm_treasury_settlements (
        id TEXT PRIMARY KEY,
        source_workspace TEXT NOT NULL CHECK (source_workspace IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        target_workspace TEXT NOT NULL CHECK (target_workspace IN ('ARM_B2B', 'P2P_DESK', 'FINANCE_360')),
        idempotency_key TEXT UNIQUE NOT NULL,
        net_profit_usdt REAL NOT NULL,
        settlement_date TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_arm_treasury_settlements_source_date ON arm_treasury_settlements(source_workspace, settlement_date DESC);

      CREATE TABLE IF NOT EXISTS f360_snapshots (
        workspace_id TEXT PRIMARY KEY CHECK (workspace_id = 'FINANCE_360'),
        schema_version INTEGER NOT NULL DEFAULT 2,
        snapshot_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS f360_vaults (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        name TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'other',
        scope TEXT NOT NULL DEFAULT 'personal',
        currency TEXT NOT NULL DEFAULT 'USD',
        vault_kind TEXT NOT NULL DEFAULT 'liquid',
        balance REAL NOT NULL DEFAULT 0,
        opening_balance REAL NOT NULL DEFAULT 0,
        bank_code TEXT NOT NULL DEFAULT '',
        account_number_masked TEXT NOT NULL DEFAULT '',
        is_fixed_asset INTEGER NOT NULL DEFAULT 0 CHECK (is_fixed_asset IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_vaults_workspace_scope ON f360_vaults(workspace_id, scope, currency);

      CREATE TABLE IF NOT EXISTS f360_ledger_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        entry_type TEXT NOT NULL CHECK (entry_type IN ('INCOME', 'EXPENSE', 'TRANSFER_OUT', 'TRANSFER_IN', 'GOAL_RESERVE')),
        entry_group_id TEXT,
        title TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'personal',
        category TEXT NOT NULL DEFAULT 'other',
        channel TEXT NOT NULL DEFAULT 'other',
        vault_id TEXT,
        liability_id TEXT,
        goal_id TEXT,
        quote_id TEXT,
        amount_original REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        bcv_rate REAL,
        parallel_rate REAL,
        eur_usd_rate REAL,
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_ves REAL NOT NULL DEFAULT 0,
        entry_date TEXT NOT NULL,
        reference_number TEXT,
        notes TEXT,
        drawer_allocation TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_ledger_workspace_date ON f360_ledger_entries(workspace_id, entry_date DESC, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_f360_ledger_ref ON f360_ledger_entries(workspace_id, vault_id, reference_number)
        WHERE vault_id IS NOT NULL AND reference_number IS NOT NULL AND reference_number <> '';

      CREATE TABLE IF NOT EXISTS f360_liabilities (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        title TEXT NOT NULL,
        creditor TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'personal',
        category TEXT NOT NULL DEFAULT 'other',
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_ves REAL NOT NULL DEFAULT 0,
        bcv_rate REAL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        amount_paid REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        cashea_plan_id TEXT,
        provider_id TEXT,
        notes TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_liabilities_workspace_due ON f360_liabilities(workspace_id, status, due_date ASC);

      CREATE TABLE IF NOT EXISTS f360_cashea_plans (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        product_name TEXT NOT NULL,
        store_name TEXT NOT NULL DEFAULT '',
        credit_line TEXT NOT NULL DEFAULT 'principal',
        club_level INTEGER NOT NULL DEFAULT 1,
        total_price_usd REAL NOT NULL DEFAULT 0,
        initial_pct REAL NOT NULL DEFAULT 60,
        initial_payment_usd REAL NOT NULL DEFAULT 0,
        installments_count INTEGER NOT NULL DEFAULT 3,
        installment_amount_usd REAL NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        installments_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_cashea_plans_workspace_status ON f360_cashea_plans(workspace_id, status);

      CREATE TABLE IF NOT EXISTS f360_quotes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        quote_number TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_doc TEXT,
        quote_type TEXT NOT NULL DEFAULT 'custom_universal',
        labor_type TEXT NOT NULL DEFAULT 'project_fixed',
        line_items_json TEXT NOT NULL DEFAULT '[]',
        totals_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        bcv_rate_applied REAL NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_quotes_workspace_status ON f360_quotes(workspace_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS f360_providers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        phone TEXT NOT NULL DEFAULT '',
        bank_details TEXT NOT NULL DEFAULT '',
        outstanding_debt_usd REAL NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_providers_workspace_name ON f360_providers(workspace_id, name ASC);

      CREATE TABLE IF NOT EXISTS f360_inventory_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        name TEXT NOT NULL,
        sku TEXT,
        category TEXT NOT NULL DEFAULT 'general',
        current_stock REAL NOT NULL DEFAULT 0,
        minimum_stock REAL NOT NULL DEFAULT 0,
        optimal_stock REAL NOT NULL DEFAULT 0,
        unit_cost_usd REAL NOT NULL DEFAULT 0,
        selling_price_usd REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'optimal',
        last_movement_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_inventory_workspace_movement ON f360_inventory_items(workspace_id, last_movement_at ASC);

      CREATE TABLE IF NOT EXISTS f360_goals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        title TEXT NOT NULL,
        target_amount_usd REAL NOT NULL DEFAULT 0,
        current_amount_usd REAL NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'personal',
        deadline TEXT,
        category TEXT NOT NULL DEFAULT 'savings',
        vault_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_goals_workspace_scope ON f360_goals(workspace_id, scope);

      CREATE TABLE IF NOT EXISTS f360_recurring_rules (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        title TEXT NOT NULL,
        entry_type TEXT NOT NULL DEFAULT 'EXPENSE',
        scope TEXT NOT NULL DEFAULT 'personal',
        category TEXT NOT NULL DEFAULT 'other',
        channel TEXT NOT NULL DEFAULT 'other',
        vault_id TEXT,
        amount_original REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        cadence TEXT NOT NULL DEFAULT 'monthly',
        next_run_date TEXT NOT NULL,
        last_run_date TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_recurring_workspace_next ON f360_recurring_rules(workspace_id, is_active, next_run_date ASC);

      CREATE TABLE IF NOT EXISTS f360_cashea_merchant_sales (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL DEFAULT 'FINANCE_360' CHECK (workspace_id = 'FINANCE_360'),
        sale_date TEXT NOT NULL,
        concept TEXT NOT NULL,
        sale_amount_usd REAL NOT NULL DEFAULT 0,
        replacement_cost_usd REAL NOT NULL DEFAULT 0,
        bcv_rate REAL NOT NULL DEFAULT 0,
        parallel_rate REAL NOT NULL DEFAULT 0,
        initial_pct REAL NOT NULL DEFAULT 40,
        installments_count INTEGER NOT NULL DEFAULT 3,
        mdr_commission_pct REAL NOT NULL DEFAULT 4,
        advance_fee_pct REAL NOT NULL DEFAULT 0,
        uses_weekly_advance INTEGER NOT NULL DEFAULT 0 CHECK (uses_weekly_advance IN (0, 1)),
        net_profit_usd REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_f360_merchant_sales_workspace_date ON f360_cashea_merchant_sales(workspace_id, sale_date DESC);
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
      history: row['history_json']
        ? (JSON.parse(row['history_json'] as string) as FsmOrderContext['history'])
        : [],
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
    const rows = stmt.all() as Record<string, unknown>[];
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
      history: row['history_json']
        ? (JSON.parse(row['history_json'] as string) as FsmOrderContext['history'])
        : [],
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
    const existing = checkStmt.get(dedupHash, cleanBank, cleanRef, thirtyDaysAgo) as
      { id: number } | undefined;

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
    stmt.run(
      audit.orderId,
      audit.fromState,
      audit.toState,
      audit.event,
      audit.reason ?? null,
      audit.timestamp,
    );
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
        status, es_simulated, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        es_simulated = excluded.es_simulated,
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
      // Default to simulated when unknown: fail closed, never assume live.
      (plan.esSimulado === false || plan.isSimulated === false) ? 0 : 1,
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
      // Missing column on legacy rows => simulated (fail closed).
      esSimulado: row['es_simulated'] === undefined ? true : Number(row['es_simulated']) === 1,
      isSimulated: row['es_simulated'] === undefined ? true : Number(row['es_simulated']) === 1,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  /**
   * Lists strategy plans ordered by created_at DESC.
   */
  listStrategyPlans(limit = 20): StrategyPlanRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM strategy_plans ORDER BY created_at DESC LIMIT ?`);
    const rows = stmt.all(limit) as Record<string, unknown>[];
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
      esSimulado: row['es_simulated'] === undefined ? true : Number(row['es_simulated']) === 1,
      isSimulated: row['es_simulated'] === undefined ? true : Number(row['es_simulated']) === 1,
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
    let rows: Record<string, unknown>[];
    if (category) {
      stmt = this.db.prepare(`
        SELECT * FROM market_learnings WHERE category = ? ORDER BY updated_at DESC LIMIT ?
      `);
      rows = stmt.all(category, limit) as Record<string, unknown>[];
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM market_learnings ORDER BY updated_at DESC LIMIT ?
      `);
      rows = stmt.all(limit) as Record<string, unknown>[];
    }

    return rows.map((row) => ({
      id: Number(row['id']),
      topicKey: row['topic_key'] as string,
      category: row['category'] as MarketLearningRecord['category'],
      insight: row['insight'] as string,
      confidenceScore: Number(row['confidence_score']),
      sampleCount: Number(row['sample_count']),
      dataPayload: row['data_payload_json']
        ? JSON.parse(row['data_payload_json'] as string)
        : undefined,
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
    const rows = stmt.all(...params) as Record<string, unknown>[];

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
        return (
          `[ENGRAM MEMORY | topic: ${obs.topicKey} | type: ${obs.type} | conf: ${((obs.confidenceScore ?? 1) * 100).toFixed(0)}%]\n` +
          `• What: ${obs.what}\n` +
          `• Why: ${obs.why}\n` +
          `• Where: ${obs.whereAffected}\n` +
          `• Learned: ${obs.learned}`
        );
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
   * Removes a key-value configuration item. Used to drop credentials that can
   * no longer be stored securely instead of leaving them readable on disk.
   */
  deleteConfigValue(key: string): void {
    this.db.prepare('DELETE FROM app_config_kv WHERE key = ?').run(key);
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
      entry.reportedAt || Date.now(),
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
    const rows = stmt.all(...params) as Record<string, unknown>[];

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
    const stmt = this.db.prepare(
      'SELECT * FROM counterparty_blacklist ORDER BY reported_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as Record<string, unknown>[];
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
   * Persists an audit log event into SQLite for permanent institutional traceability.
   */
  recordAuditLog(event: AuditEventRecord): boolean {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO audit_logs (id, timestamp, category, action, details, severity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.timestamp,
      event.category,
      event.action,
      event.details ?? null,
      event.severity || 'info',
      event.createdAt || Date.now(),
    );
    return true;
  }

  /**
   * Lists audit logs ordered by creation time descending with optional category filter.
   */
  listAuditLogs(limit = 100, category?: string): AuditEventRecord[] {
    let sql = 'SELECT * FROM audit_logs';
    const params: (string | number)[] = [];
    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      timestamp: String(r['timestamp']),
      category: String(r['category']),
      action: String(r['action']),
      details: r['details'] ? String(r['details']) : undefined,
      severity: String(r['severity']),
      createdAt: Number(r['created_at']),
    }));
  }

  /**
   * Saves an operation record into the SQLite relational ledger.
   */
  saveOperationRecord(op: OperationRecord): boolean {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO operation_records (
        id, timestamp, side, fiat_amount, crypto_amount, price, bank, reference, counterparty, status, raw_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      op.id,
      op.timestamp,
      op.side,
      op.fiatAmount,
      op.cryptoAmount,
      op.price,
      op.bank,
      op.reference ?? null,
      op.counterparty ?? null,
      op.status,
      op.rawJson,
      op.createdAt || Date.now(),
    );
    return true;
  }

  /**
   * Lists operation records from SQLite relational ledger.
   */
  listOperationRecords(limit = 50): OperationRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM operation_records ORDER BY created_at DESC LIMIT ?',
    );
    const rows = stmt.all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      timestamp: String(r['timestamp']),
      side: String(r['side']),
      fiatAmount: Number(r['fiat_amount']),
      cryptoAmount: Number(r['crypto_amount']),
      price: Number(r['price']),
      bank: String(r['bank']),
      reference: r['reference'] ? String(r['reference']) : undefined,
      counterparty: r['counterparty'] ? String(r['counterparty']) : undefined,
      status: String(r['status']),
      rawJson: String(r['raw_json']),
      createdAt: Number(r['created_at']),
    }));
  }

  /**
   * Saves or updates a bank account record in SQLite.
   */
  saveBankAccount(acc: BankAccountRecord): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO bank_accounts (
        id, bank_name, bank_code, rail, account_number_masked,
        daily_limit_ves, monthly_limit_ves, initial_balance_ves,
        status, max_daily_transactions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      acc.id,
      acc.bankName,
      acc.bankCode,
      acc.rail,
      acc.accountNumberMasked,
      acc.dailyLimitVes,
      acc.monthlyLimitVes ?? 0,
      acc.initialBalanceVes,
      acc.status ?? 'ACTIVE',
      acc.maxDailyTransactions ?? 15,
      acc.createdAt || now,
      acc.updatedAt || now,
    );
    return true;
  }

  /**
   * Retrieves a single bank account by id.
   */
  getBankAccount(id: string): BankAccountRecord | null {
    const stmt = this.db.prepare('SELECT * FROM bank_accounts WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapBankAccountRow(row);
  }

  /**
   * Lists bank accounts, optionally filtering by status and/or bankCode.
   */
  listBankAccounts(filter?: { status?: string; bankCode?: string }): BankAccountRecord[] {
    let query = 'SELECT * FROM bank_accounts WHERE 1=1';
    const params: string[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.bankCode) {
      query += ' AND bank_code = ?';
      params.push(filter.bankCode);
    }
    query += ' ORDER BY bank_name ASC';

    const stmt = this.db.prepare(query);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
    return rows.map((r) => this.mapBankAccountRow(r));
  }

  /**
   * Deletes a bank account by id. Returns true if an account was deleted.
   */
  deleteBankAccount(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM bank_accounts WHERE id = ?');
    const info = stmt.run(id);
    return Number(info.changes) > 0;
  }

  /**
   * Decision Journal bound to this connection. The schema is applied in the
   * constructor, so the journal tables exist by the time anyone asks for it.
   */
  getDecisionJournal(): DecisionJournalRepository {
    if (!this.decisionJournal) {
      this.decisionJournal = new SqliteDecisionJournalRepository(this.db);
    }
    return this.decisionJournal;
  }

  /**
   * Retention for the only prunable journal table. Snapshots still cited by a decision
   * are kept: losing the evidence a decision rests on is worse than a large file.
   *
   * @param cutoff exclusive epoch-ms bound on `fetched_at`.
   * @returns the number of snapshots actually deleted.
   */
  purgeMarketSnapshotsBefore(cutoff: number): number {
    return purgeMarketSnapshotsBefore(this.db, cutoff);
  }

  listMarketSnapshots(filter?: MarketSnapshotsFilter): MarketSnapshot[] {
    return listMarketSnapshots(this.db, filter);
  }

  private mapBankAccountRow(r: Record<string, unknown>): BankAccountRecord {
    return {
      id: String(r['id']),
      bankName: String(r['bank_name']),
      bankCode: String(r['bank_code']),
      rail: r['rail'] as 'PAGO_MOVIL' | 'TRANSFERENCIA' | 'MIXTO',
      accountNumberMasked: String(r['account_number_masked']),
      dailyLimitVes: Number(r['daily_limit_ves']),
      monthlyLimitVes: r['monthly_limit_ves'] ? Number(r['monthly_limit_ves']) : 0,
      initialBalanceVes: Number(r['initial_balance_ves']),
      status: (r['status'] as 'ACTIVE' | 'DISABLED') ?? 'ACTIVE',
      maxDailyTransactions: r['max_daily_transactions'] ? Number(r['max_daily_transactions']) : 15,
      createdAt: Number(r['created_at']),
      updatedAt: Number(r['updated_at']),
    };
  }

  getCustomAgentRepo(): CustomAgentRepository {
    if (!this.customAgentRepo) {
      this.customAgentRepo = new CustomAgentRepository(this.db);
      this.customAgentRepo.seedDefaultsIfEmpty();
    }
    return this.customAgentRepo;
  }

  getArmRepo(): ArmRepository {
    if (!this.armRepo) {
      this.armRepo = new ArmRepository(this.db);
    }
    return this.armRepo;
  }

  getFinance360Repo(): Finance360Repository {
    if (!this.finance360Repo) {
      this.finance360Repo = new Finance360Repository(this.db);
    }
    return this.finance360Repo;
  }

  get finance360(): Finance360Repository {
    return this.getFinance360Repo();
  }

  /**
   * Marks a proposed strategy plan as REJECTED by the operator.
   */
  rejectStrategyPlan(planId: string, reason?: string): { success: boolean } {
    const existing = this.getStrategyPlan(planId);
    if (!existing) {
      return { success: false };
    }
    const nextRationale = reason
      ? `${existing.rationale} [RECHAZADO: ${reason}]`
      : existing.rationale;
    this.db
      .prepare(`UPDATE strategy_plans SET status = 'REJECTED', rationale = ?, updated_at = ? WHERE id = ?`)
      .run(nextRationale, Date.now(), planId);
    return { success: true };
  }

  /**
   * Resolves a quarantined Engram observation (`needs_review`) by approving or discarding it.
   */
  reviewEngramObservation(id: number, action: 'approve' | 'discard'): EngramReviewResult {
    const existing = this.db
      .prepare(`SELECT id FROM engram_observations WHERE id = ?`)
      .get(id) as { id: number } | undefined;
    if (!existing) {
      return { success: false, id, status: 'not_found' };
    }

    if (action === 'approve') {
      this.db
        .prepare(`UPDATE engram_observations SET status = 'active', updated_at = ? WHERE id = ?`)
        .run(Date.now(), id);
      return { success: true, id, status: 'active' };
    }

    this.db.prepare(`DELETE FROM engram_observations WHERE id = ?`).run(id);
    return { success: true, id, status: 'discarded' };
  }

  /**
   * Creates a persistent Copilot conversation thread.
   */
  createCopilotThread(params: { id?: string; title: string; agentId?: string | null }): CopilotThreadDto {
    const now = Date.now();
    const id = params.id || `THR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const title = params.title.trim() || 'Nueva conversación táctica';
    this.db
      .prepare(
        `INSERT INTO copilot_threads (id, title, agent_id, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(id, title, params.agentId ?? null, now, now);
    return {
      id,
      title,
      agentId: params.agentId ?? null,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
  }

  /**
   * Lists persistent Copilot conversation threads with message counts.
   */
  listCopilotThreads(limit = 30): CopilotThreadDto[] {
    const rows = this.db
      .prepare(
        `
        SELECT t.*, COUNT(m.id) AS message_count
        FROM copilot_threads t
        LEFT JOIN copilot_messages m ON m.thread_id = t.id
        GROUP BY t.id
        ORDER BY t.pinned DESC, t.updated_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row['id']),
      title: String(row['title']),
      agentId: row['agent_id'] ? String(row['agent_id']) : null,
      pinned: Number(row['pinned']) === 1,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
      messageCount: Number(row['message_count'] ?? 0),
    }));
  }

  /**
   * Returns chronological messages for a persistent Copilot thread.
   */
  getCopilotThreadMessages(threadId: string, limit = 50): CopilotThreadMessageDto[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM (
          SELECT *, rowid AS _rid FROM copilot_messages
          WHERE thread_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?
        ) sub
        ORDER BY created_at ASC, _rid ASC
      `,
      )
      .all(threadId, limit) as Record<string, unknown>[];

    return rows.map((row) => {
      let provenance: ProvenanceMetadata | null = null;
      let toolTraces: ToolCallTrace[] | null = null;
      try {
        if (row['provenance_json']) {
          provenance = JSON.parse(String(row['provenance_json'])) as ProvenanceMetadata;
        }
      } catch {
        provenance = null;
      }
      try {
        if (row['tool_traces_json']) {
          toolTraces = JSON.parse(String(row['tool_traces_json'])) as ToolCallTrace[];
        }
      } catch {
        toolTraces = null;
      }

      return {
        id: String(row['id']),
        threadId: String(row['thread_id']),
        role: row['role'] as 'user' | 'assistant',
        content: String(row['content']),
        model: row['model'] ? String(row['model']) : null,
        provider: row['provider'] ? String(row['provider']) : null,
        provenance,
        toolTraces,
        planId: row['plan_id'] ? String(row['plan_id']) : null,
        tokensIn: Number(row['tokens_in'] ?? 0),
        tokensOut: Number(row['tokens_out'] ?? 0),
        costUsd: Number(row['cost_usd'] ?? 0),
        latencyMs: Number(row['latency_ms'] ?? 0),
        createdAt: Number(row['created_at']),
      };
    });
  }

  /**
   * Appends a message to a Copilot thread (auto-creating the thread if missing) and bumps updated_at.
   */
  appendCopilotMessage(
    msg: Omit<CopilotThreadMessageDto, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
  ): CopilotThreadMessageDto {
    const now = msg.createdAt ?? Date.now();
    const id = msg.id || `MSG-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;

    const threadExists = this.db
      .prepare(`SELECT id FROM copilot_threads WHERE id = ?`)
      .get(msg.threadId) as { id: string } | undefined;
    if (!threadExists) {
      const autoTitle = msg.content.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Conversación táctica';
      this.createCopilotThread({ id: msg.threadId, title: autoTitle });
    }

    this.db
      .prepare(
        `
        INSERT INTO copilot_messages (
          id, thread_id, role, content, model, provider,
          provenance_json, tool_traces_json, plan_id,
          tokens_in, tokens_out, cost_usd, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        msg.threadId,
        msg.role,
        msg.content,
        msg.model ?? null,
        msg.provider ?? null,
        msg.provenance ? JSON.stringify(msg.provenance) : null,
        msg.toolTraces ? JSON.stringify(msg.toolTraces) : null,
        msg.planId ?? null,
        msg.tokensIn ?? 0,
        msg.tokensOut ?? 0,
        msg.costUsd ?? 0,
        msg.latencyMs ?? 0,
        now,
      );

    this.db.prepare(`UPDATE copilot_threads SET updated_at = ? WHERE id = ?`).run(now, msg.threadId);

    return {
      id,
      threadId: msg.threadId,
      role: msg.role,
      content: msg.content,
      model: msg.model ?? null,
      provider: msg.provider ?? null,
      provenance: msg.provenance ?? null,
      toolTraces: msg.toolTraces ?? null,
      planId: msg.planId ?? null,
      tokensIn: msg.tokensIn ?? 0,
      tokensOut: msg.tokensOut ?? 0,
      costUsd: msg.costUsd ?? 0,
      latencyMs: msg.latencyMs ?? 0,
      createdAt: now,
    };
  }

  /**
   * Deletes a persistent Copilot thread and its cascaded messages.
   */
  deleteCopilotThread(threadId: string): boolean {
    const res = this.db.prepare(`DELETE FROM copilot_threads WHERE id = ?`).run(threadId);
    return Number(res.changes ?? 0) > 0;
  }

  /**
   * Records a metered LLM or cache-hit turn into the usage ledger.
   */
  recordCopilotUsage(entry: {
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    cached: boolean;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO copilot_usage_ledger (
          provider, model, tokens_in, tokens_out, cost_usd, latency_ms, cached, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        entry.provider,
        entry.model,
        Math.max(0, Math.round(entry.tokensIn)),
        Math.max(0, Math.round(entry.tokensOut)),
        Math.max(0, entry.costUsd),
        Math.max(0, Math.round(entry.latencyMs)),
        entry.cached ? 1 : 0,
        Date.now(),
      );
  }

  /**
   * Aggregates real Copilot token usage, cost, cache hits, and P95 latency over a time window.
   */
  getCopilotUsageSummary(windowHours = 24): CopilotUsageSummaryDto {
    const cutoff = Date.now() - Math.max(1, windowHours) * 3_600_000;
    const rows = this.db
      .prepare(
        `SELECT provider, model, tokens_in, tokens_out, cost_usd, latency_ms, cached FROM copilot_usage_ledger WHERE created_at >= ?`,
      )
      .all(cutoff) as Record<string, unknown>[];

    let totalCalls = 0;
    let cachedCalls = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd = 0;
    const latencies: number[] = [];
    const byModelMap = new Map<
      string,
      {
        provider: string;
        model: string;
        calls: number;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
      }
    >();

    for (const r of rows) {
      totalCalls++;
      const isCached = Number(r['cached']) === 1;
      if (isCached) cachedCalls++;
      const tIn = Number(r['tokens_in'] ?? 0);
      const tOut = Number(r['tokens_out'] ?? 0);
      const cost = Number(r['cost_usd'] ?? 0);
      const lat = Number(r['latency_ms'] ?? 0);
      totalTokensIn += tIn;
      totalTokensOut += tOut;
      totalCostUsd += cost;
      if (!isCached && lat > 0) latencies.push(lat);

      const provider = String(r['provider']);
      const model = String(r['model']);
      const key = `${provider}:${model}`;
      const existing = byModelMap.get(key) || {
        provider,
        model,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      };
      existing.calls++;
      existing.tokensIn += tIn;
      existing.tokensOut += tOut;
      existing.costUsd += cost;
      byModelMap.set(key, existing);
    }

    let p95LatencyMs: number | null = null;
    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const idx = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
      p95LatencyMs = latencies[idx];
    }

    return {
      windowHours,
      totalCalls,
      cachedCalls,
      totalTokensIn,
      totalTokensOut,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      p95LatencyMs,
      byModel: Array.from(byModelMap.values()),
    };
  }

  close(): void {
    this.decisionJournal = null;
    this.customAgentRepo = null;
    this.armRepo = null;
    this.finance360Repo = null;
    this.db.close();
  }
}


