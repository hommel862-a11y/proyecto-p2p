-- Antigravity P2P Suite SQLite Relational Schema
-- High-concurrency WAL Mode persistence for Order FSM, Inbound BankOps Deduplication & Audit Log

CREATE TABLE IF NOT EXISTS p2p_orders (
  order_id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
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

CREATE INDEX IF NOT EXISTS idx_orders_state ON p2p_orders(current_state);
CREATE INDEX IF NOT EXISTS idx_orders_updated ON p2p_orders(updated_at DESC);

CREATE TABLE IF NOT EXISTS inbound_bank_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_hash TEXT UNIQUE NOT NULL,
  bank TEXT NOT NULL,
  reference TEXT NOT NULL,
  payer_name TEXT,
  payer_id_doc TEXT,
  amount_fiat REAL NOT NULL,
  raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'MATCHED', 'DUPLICATE', 'DISPUTED', 'DISCARDED')),
  matched_order_id TEXT REFERENCES p2p_orders(order_id),
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_events_ref ON inbound_bank_events(bank, reference);
CREATE INDEX IF NOT EXISTS idx_bank_events_time ON inbound_bank_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_events_hash ON inbound_bank_events(dedup_hash);

CREATE TABLE IF NOT EXISTS fsm_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event TEXT NOT NULL,
  reason TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_order ON fsm_audit_log(order_id);

CREATE TABLE IF NOT EXISTS app_config_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
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
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  assigned_operator_id TEXT,
  assigned_operator_name TEXT,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'EXECUTED', 'CANCELLED', 'REJECTED')),
  -- Provenance of the numbers. 1 = built from reference values, 0 = built from a live
  -- feed. Defaults to 1 so the dispatch gate fails closed, including for legacy rows.
  es_simulated INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_status ON strategy_plans(status);
CREATE INDEX IF NOT EXISTS idx_strategy_time ON strategy_plans(created_at DESC);

CREATE TABLE IF NOT EXISTS market_learnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('SPREAD_CYCLE', 'BCV_IMPACT', 'OPERATOR_PERFORMANCE', 'COUNTERPARTY_BEHAVIOR', 'TRIANGULATION_ROUTE')),
  insight TEXT NOT NULL,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  sample_count INTEGER NOT NULL DEFAULT 1,
  data_payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learnings_topic ON market_learnings(topic_key);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON market_learnings(category);

-- Engram Persistent Long-Term Memory Protocol
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

-- Institutional Audit Log (Unlimited Retention)
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

-- Operation Records (Relational Ledger)
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

-- Bank Accounts (Institutional Treasury Ledger)
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

-- ===========================================================================
-- Decision Journal (append-only memory of what the engine decided, saw, and got)
-- ===========================================================================
--
-- The port lives in `projects/core/src/lib/decision-journal-repository.ts` and its
-- in-memory adapter there is the executable specification of the contract.
-- `electron/tsconfig.json` pins `rootDir: "."` and cannot import from
-- `projects/core` (tsc TS6059), so the adapter mirrors the contract locally and
-- `main/db/decision-journal.repository.spec.ts` proves the two agree. The same
-- constraint is why the enum CHECK lists below are literal copies rather than
-- generated: their single source of truth is the arrays exported by
-- `projects/core/src/lib/decision-journal.ts` (DECISION_SIDES, DECISION_ORIGINS,
-- DECISION_CYCLE_STATUSES, DECISION_EXECUTION_MODES, OUTCOME_SOURCES) plus
-- `RepricerDecision['action']` from `projects/core/src/lib/repricer.ts`, and the
-- spec asserts each CHECK list equals those arrays, in order.
--
-- Only `decision_cycles` is mutable (via `closeCycle`). Snapshots, decisions and
-- outcomes are never updated or deleted: a journal that gets rewritten loses the
-- property that makes it trustworthy. `market_snapshots` is the one prunable table
-- (see `purgeMarketSnapshotsBefore`), and the hard FK below means a snapshot a
-- decision still cites can never be purged.

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  obi REAL NOT NULL,
  bid_usd REAL NOT NULL,
  ask_usd REAL NOT NULL,
  n_bids INTEGER NOT NULL,
  n_asks INTEGER NOT NULL,
  stale INTEGER NOT NULL CHECK (stale IN (0, 1)),
  btc_usdt REAL,
  sol_usdt REAL,
  usdc_usdt REAL,
  bcv_ves REAL,
  fetched_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_fetched_at ON market_snapshots(fetched_at);

CREATE TABLE IF NOT EXISTS decision_cycles (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'ABANDONED')),
  title TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR', 'AUTO_ENGINE', 'MCP_AGENT', 'STRATEGY_PLAN')),
  capital_reserved_usdt REAL NOT NULL,
  realized_profit_usdt REAL,
  realized_spread_pct REAL,
  close_reason TEXT,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- `closed_at IS NULL` is exactly `status = 'OPEN'`: `openCycle` writes NULL and no
  -- other code path sets it, while `closeCycle` is the only writer of a terminal status
  -- and always stamps it. So the two disagreeing pairs — open but stamped, and closed but
  -- unstamped — have no legitimate producer, and one of them is the shape a
  -- `closeCycle({ status: 'OPEN' })` used to leave behind. Stated here so the invariant
  -- does not live only in the adapter, which raw SQL and an unvalidated IPC payload both
  -- bypass.
  --
  -- Note for anyone adding a migration: this constraint is NOT retrofitted. Every journal
  -- object is `CREATE TABLE IF NOT EXISTS`, so an existing database keeps its original
  -- definition and its rows verbatim — an install upgraded from an older build is protected
  -- by the adapter guards instead. Do not turn this into a table rebuild to "fix" old rows
  -- without first counting them: that is a data migration, and this file has no version
  -- table to make it repeatable.
  CHECK ((status = 'OPEN') = (closed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_decision_cycles_status ON decision_cycles(status);
CREATE INDEX IF NOT EXISTS idx_decision_cycles_origin ON decision_cycles(origin);
CREATE INDEX IF NOT EXISTS idx_decision_cycles_created ON decision_cycles(created_at);

CREATE TABLE IF NOT EXISTS repricer_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Hard reference: a decision that cannot name its cycle is not auditable.
  cycle_id TEXT NOT NULL REFERENCES decision_cycles(id),
  -- Hard reference: a decision without the market it was taken on cannot be audited.
  snapshot_id INTEGER NOT NULL REFERENCES market_snapshots(id),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  decision_price REAL NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR', 'AUTO_ENGINE', 'MCP_AGENT', 'STRATEGY_PLAN')),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('READ_ONLY', 'PUBLISHING')),
  action TEXT NOT NULL CHECK (action IN ('UPDATE', 'KEEP', 'PAUSE')),
  modeled_spread_pct REAL NOT NULL,
  reason TEXT NOT NULL,
  safety_flags_json TEXT NOT NULL,
  -- Observed context, copied from the referenced snapshot at write time so the
  -- decision can never contradict its own evidence.
  observed_obi REAL NOT NULL,
  observed_bid_usd REAL NOT NULL,
  observed_ask_usd REAL NOT NULL,
  observed_stale INTEGER NOT NULL CHECK (observed_stale IN (0, 1)),
  -- Soft references: no FK, because those entities are not persisted yet.
  account_id TEXT,
  plan_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repricer_decisions_cycle ON repricer_decisions(cycle_id);
CREATE INDEX IF NOT EXISTS idx_repricer_decisions_snapshot ON repricer_decisions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_repricer_decisions_created ON repricer_decisions(created_at);
CREATE INDEX IF NOT EXISTS idx_repricer_decisions_stale ON repricer_decisions(observed_stale);

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Hard reference: an outcome is always attached to a decision.
  decision_id INTEGER NOT NULL REFERENCES repricer_decisions(id),
  source TEXT NOT NULL CHECK (source IN ('LOCAL_SIGNAL', 'BINANCE_MERCHANT', 'CSV_IMPORT', 'MANUAL')),
  -- A failed publish is a row with success = 0, never a missing row.
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  filled_amount_usdt REAL NOT NULL,
  filled_price REAL,
  realized_spread_pct REAL,
  realized_profit_usdt REAL,
  external_ref TEXT,
  detail TEXT,
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_outcomes_decision ON decision_outcomes(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_outcomes_recorded ON decision_outcomes(recorded_at);

-- Read model: every decision LEFT JOINed with its outcomes, so an unverified decision
-- is still visible with fill_count = 0. The spread columns are the RAW ingredients of
-- the notional-weighted mean (numerator, denominator, plain-sum, reporting count) and
-- the aggregation fallback is decided in the adapter, which is the only place allowed
-- to know the reference semantics.
CREATE VIEW IF NOT EXISTS decision_performance AS
SELECT
  d.id AS decision_id,
  d.cycle_id,
  d.snapshot_id,
  d.side,
  d.origin,
  d.execution_mode,
  d.action,
  d.decision_price,
  d.modeled_spread_pct,
  d.observed_stale,
  d.observed_obi,
  d.created_at AS decided_at,
  COUNT(o.id) AS fill_count,
  SUM(o.filled_amount_usdt) AS filled_amount_usdt,
  SUM(o.realized_profit_usdt) AS realized_profit_usdt,
  SUM(CASE WHEN o.realized_spread_pct IS NOT NULL
           THEN o.realized_spread_pct * o.filled_amount_usdt ELSE 0 END) AS spread_weighted_numerator,
  SUM(CASE WHEN o.realized_spread_pct IS NOT NULL
           THEN o.filled_amount_usdt ELSE 0 END) AS spread_weighted_denominator,
  SUM(CASE WHEN o.realized_spread_pct IS NOT NULL
           THEN o.realized_spread_pct ELSE 0 END) AS spread_plain_sum,
  COUNT(CASE WHEN o.realized_spread_pct IS NOT NULL THEN 1 END) AS spread_reporting_count
FROM repricer_decisions d
LEFT JOIN decision_outcomes o ON o.decision_id = d.id
GROUP BY d.id;

-- ============================================================================
-- Custom Agent Studio (Dynamic Multi-Agent Swarm)
-- ============================================================================

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
  domain TEXT NOT NULL DEFAULT 'P2P_DESK' CHECK (domain IN ('P2P_DESK', 'FINANCE_360', 'ARM_B2B', 'SECURITY')),
  daily_budget_usd REAL NOT NULL DEFAULT 1.5,
  max_steps INTEGER NOT NULL DEFAULT 6,
  prompt_version INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('daemon_tick', 'manual_run', 'sandbox_test', 'copilot_mention')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'blocked_killswitch', 'blocked_budget', 'timeout')),
  prompt_input TEXT NOT NULL,
  response_output TEXT,
  tools_called_json TEXT NOT NULL DEFAULT '[]',
  model_used TEXT NOT NULL,
  provider_used TEXT NOT NULL DEFAULT 'gemini',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_time ON agent_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status_time ON agent_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC);

-- ============================================================================
-- ARM Multi-Workspace Local-First Mirror (SQLite Dual-Mode Sync)
-- ============================================================================

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

-- ============================================================================
-- Finanzas 360 Institutional Ledger Local-First Mirror (SQLite)
-- ============================================================================

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

-- ============================================================================
-- Tactical Copilot Persistent Threads, Messages & Token Usage Ledger
-- ============================================================================

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

