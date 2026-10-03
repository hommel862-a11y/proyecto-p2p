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



