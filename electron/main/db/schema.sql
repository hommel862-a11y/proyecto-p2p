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

