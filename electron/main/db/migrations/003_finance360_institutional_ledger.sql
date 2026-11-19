-- ============================================================================
-- 003_finance360_institutional_ledger.sql
-- Idempotent PostgreSQL 17 institutional ledger migration for Finanzas 360
-- Silo: FINANCE_360 (Strict RLS + Double-Entry + Cashea N1-N6 + Pyme + Quotes)
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure canonical workspace rows exist before adding workspace FK defaults
INSERT INTO workspaces (id, display_name, accent_color_hex, default_currency, debounce_window_ms, daily_ai_budget_usd)
VALUES
    ('ARM_B2B', 'ARM Comercial B2B', '#30D158', 'USD', 3000, 15.00),
    ('P2P_DESK', 'Mesa P2P & Liquidez', '#0A84FF', 'USDT', 2000, 15.00),
    ('FINANCE_360', 'Finanzas & PyME 360', '#FFD60A', 'USD', 3000, 15.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 1. CANONICAL SNAPSHOT & CORE LEDGER TABLES (FINANCE_360)
-- ============================================================================

CREATE TABLE IF NOT EXISTS f360_snapshots (
    workspace_id workspace_code PRIMARY KEY DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    schema_version INT NOT NULL DEFAULT 2 CHECK (schema_version >= 1),
    snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    checksum VARCHAR(64) NOT NULL DEFAULT '',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_vaults (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'other',
    scope VARCHAR(24) NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('all', 'personal', 'business')),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD'
        CHECK (currency IN ('USD', 'VES', 'USDT', 'EUR')),
    vault_kind VARCHAR(32) NOT NULL DEFAULT 'liquid'
        CHECK (vault_kind IN ('liquid', 'reserve', 'receivable', 'fixed_asset', 'savings')),
    balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
    opening_balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
    bank_code VARCHAR(32) NOT NULL DEFAULT '',
    account_number_masked VARCHAR(64) NOT NULL DEFAULT '',
    is_fixed_asset BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_ledger_entries (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    entry_type VARCHAR(24) NOT NULL
        CHECK (entry_type IN ('INCOME', 'EXPENSE', 'TRANSFER_OUT', 'TRANSFER_IN', 'GOAL_RESERVE')),
    entry_group_id VARCHAR(120),
    title VARCHAR(200) NOT NULL,
    scope VARCHAR(24) NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('all', 'personal', 'business')),
    category VARCHAR(64) NOT NULL DEFAULT 'other',
    channel VARCHAR(32) NOT NULL DEFAULT 'other',
    vault_id VARCHAR(120) REFERENCES f360_vaults(id) ON DELETE SET NULL,
    liability_id VARCHAR(120),
    goal_id VARCHAR(120),
    quote_id VARCHAR(120),
    amount_original NUMERIC(18, 6) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD'
        CHECK (currency IN ('USD', 'VES', 'USDT', 'EUR')),
    bcv_rate NUMERIC(18, 6),
    parallel_rate NUMERIC(18, 6),
    eur_usd_rate NUMERIC(18, 6),
    amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    amount_ves NUMERIC(18, 6) NOT NULL DEFAULT 0,
    entry_date DATE NOT NULL,
    reference_number VARCHAR(120),
    notes TEXT,
    drawer_allocation VARCHAR(48),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_f360_ledger_no_replay
    ON f360_ledger_entries (workspace_id, vault_id, reference_number)
    WHERE reference_number IS NOT NULL AND reference_number <> '';

CREATE TABLE IF NOT EXISTS f360_liabilities (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    creditor VARCHAR(150) NOT NULL,
    scope VARCHAR(24) NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('all', 'personal', 'business')),
    category VARCHAR(32) NOT NULL DEFAULT 'other'
        CHECK (category IN ('cashea', 'provider', 'loan', 'fixed_service', 'tax', 'other')),
    amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    amount_ves NUMERIC(18, 6) NOT NULL DEFAULT 0,
    bcv_rate NUMERIC(18, 6),
    due_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue')),
    amount_paid NUMERIC(18, 6) NOT NULL DEFAULT 0,
    remaining_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    cashea_plan_id VARCHAR(120),
    provider_id VARCHAR(120),
    notes TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. CASHEA 2026 (LEVELS 1-6 ARAGUANEY, DUAL LINES & MERCHANT ALLY MODE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS f360_cashea_profiles (
    workspace_id workspace_code PRIMARY KEY DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    club_level INT NOT NULL DEFAULT 1 CHECK (club_level BETWEEN 1 AND 6),
    principal_limit_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    cotidiana_limit_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    total_paid_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    paid_installments_count INT NOT NULL DEFAULT 0 CHECK (paid_installments_count >= 0),
    next_recalc_date DATE,
    merchant_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_cashea_plans (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    product_name VARCHAR(200) NOT NULL,
    store_name VARCHAR(150) NOT NULL DEFAULT '',
    credit_line VARCHAR(24) NOT NULL DEFAULT 'principal'
        CHECK (credit_line IN ('principal', 'cotidiana', 'vehicular')),
    club_level INT NOT NULL DEFAULT 1 CHECK (club_level BETWEEN 1 AND 6),
    total_price_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    initial_pct NUMERIC(18, 6) NOT NULL DEFAULT 60,
    initial_payment_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    installments_count INT NOT NULL DEFAULT 3 CHECK (installments_count > 0),
    installment_amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    installment_frequency_days INT NOT NULL DEFAULT 14 CHECK (installment_frequency_days > 0),
    start_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled', 'overdue')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_cashea_installments (
    id VARCHAR(120) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id VARCHAR(120) NOT NULL REFERENCES f360_cashea_plans(id) ON DELETE CASCADE,
    installment_number INT NOT NULL CHECK (installment_number > 0),
    credit_line VARCHAR(24) NOT NULL DEFAULT 'principal'
        CHECK (credit_line IN ('principal', 'cotidiana', 'vehicular')),
    club_level INT NOT NULL DEFAULT 1 CHECK (club_level BETWEEN 1 AND 6),
    initial_pct NUMERIC(18, 6) NOT NULL DEFAULT 60,
    initial_payment_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue')),
    due_date DATE NOT NULL,
    amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    amount_paid_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    paid_ves NUMERIC(18, 6),
    bcv_rate_applied NUMERIC(18, 6),
    reactivation_fee_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    payment_reference VARCHAR(120),
    paid_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, installment_number)
);

CREATE TABLE IF NOT EXISTS f360_cashea_merchant_sales (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    sale_date DATE NOT NULL,
    concept VARCHAR(200) NOT NULL,
    sale_amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    replacement_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    bcv_rate NUMERIC(18, 6) NOT NULL DEFAULT 0,
    parallel_rate NUMERIC(18, 6) NOT NULL DEFAULT 0,
    initial_pct NUMERIC(18, 6) NOT NULL DEFAULT 40,
    installments_count INT NOT NULL DEFAULT 3 CHECK (installments_count > 0),
    mdr_commission_pct NUMERIC(18, 6) NOT NULL DEFAULT 4,
    advance_fee_pct NUMERIC(18, 6) NOT NULL DEFAULT 0,
    uses_weekly_advance BOOLEAN NOT NULL DEFAULT FALSE,
    net_profit_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partially_settled', 'settled', 'cancelled')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. PYME 3-DRAWERS, PROVIDERS, INVENTORY, QUOTES, GOALS, RECURRENCES & AUDIT
-- ============================================================================

CREATE TABLE IF NOT EXISTS f360_pyme_drawers_ledger (
    id VARCHAR(120) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    drawer_key VARCHAR(48) NOT NULL
        CHECK (drawer_key IN ('drawer_merchandise', 'drawer_operations', 'drawer_capex')),
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
    amount_usd NUMERIC(18, 6) NOT NULL CHECK (amount_usd >= 0),
    source_entry_id VARCHAR(120),
    notes TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_providers (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'general',
    phone VARCHAR(48) NOT NULL DEFAULT '',
    bank_details TEXT NOT NULL DEFAULT '',
    outstanding_debt_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_inventory_items (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(180) NOT NULL,
    sku VARCHAR(64),
    category VARCHAR(80) NOT NULL DEFAULT 'general',
    current_stock NUMERIC(18, 6) NOT NULL DEFAULT 0,
    minimum_stock NUMERIC(18, 6) NOT NULL DEFAULT 0,
    optimal_stock NUMERIC(18, 6) NOT NULL DEFAULT 0,
    unit_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    selling_price_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'optimal'
        CHECK (status IN ('optimal', 'low', 'depleted')),
    last_movement_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_quotes (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    quote_number VARCHAR(64) NOT NULL,
    client_name VARCHAR(150) NOT NULL,
    client_doc VARCHAR(64),
    quote_type VARCHAR(48) NOT NULL DEFAULT 'custom_universal',
    labor_type VARCHAR(32) NOT NULL DEFAULT 'project_fixed',
    line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    totals JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'sent', 'approved', 'rejected', 'completed')),
    bcv_rate_applied NUMERIC(18, 6) NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, quote_number)
);

CREATE TABLE IF NOT EXISTS f360_goals (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    target_amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    current_amount_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    scope VARCHAR(24) NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('all', 'personal', 'business')),
    deadline DATE,
    category VARCHAR(32) NOT NULL DEFAULT 'savings',
    vault_id VARCHAR(120) REFERENCES f360_vaults(id) ON DELETE SET NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_recurring_rules (
    id VARCHAR(120) PRIMARY KEY,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    entry_type VARCHAR(24) NOT NULL
        CHECK (entry_type IN ('INCOME', 'EXPENSE', 'LIABILITY')),
    scope VARCHAR(24) NOT NULL DEFAULT 'personal'
        CHECK (scope IN ('all', 'personal', 'business')),
    category VARCHAR(64) NOT NULL DEFAULT 'other',
    channel VARCHAR(32) NOT NULL DEFAULT 'other',
    vault_id VARCHAR(120) REFERENCES f360_vaults(id) ON DELETE SET NULL,
    amount_original NUMERIC(18, 6) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD'
        CHECK (currency IN ('USD', 'VES', 'USDT', 'EUR')),
    cadence VARCHAR(24) NOT NULL DEFAULT 'monthly'
        CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
    next_run_date DATE NOT NULL,
    last_run_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS f360_vault_reconciliations (
    id VARCHAR(120) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    workspace_id workspace_code NOT NULL DEFAULT 'FINANCE_360'
        REFERENCES workspaces(id) ON DELETE CASCADE,
    vault_id VARCHAR(120) NOT NULL REFERENCES f360_vaults(id) ON DELETE CASCADE,
    expected_balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
    observed_balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
    delta_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD'
        CHECK (currency IN ('USD', 'VES', 'USDT', 'EUR')),
    bcv_rate_applied NUMERIC(18, 6),
    notes TEXT,
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    tbl TEXT;
    updated_tables TEXT[] := ARRAY[
        'f360_snapshots',
        'f360_vaults',
        'f360_ledger_entries',
        'f360_liabilities',
        'f360_cashea_profiles',
        'f360_cashea_plans',
        'f360_cashea_installments',
        'f360_cashea_merchant_sales',
        'f360_providers',
        'f360_inventory_items',
        'f360_quotes',
        'f360_goals',
        'f360_recurring_rules'
    ];
BEGIN
    FOREACH tbl IN ARRAY updated_tables
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON %I', tbl, tbl);
        EXECUTE format(
            'CREATE TRIGGER trg_%I_set_updated_at '
            'BEFORE UPDATE ON %I '
            'FOR EACH ROW '
            'EXECUTE FUNCTION set_updated_at()',
            tbl,
            tbl
        );
    END LOOP;
END $$;

-- ============================================================================
-- 5. PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_f360_vaults_workspace_scope
    ON f360_vaults (workspace_id, scope, currency);

CREATE INDEX IF NOT EXISTS idx_f360_ledger_workspace_date
    ON f360_ledger_entries (workspace_id, entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_f360_ledger_group
    ON f360_ledger_entries (workspace_id, entry_group_id)
    WHERE entry_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_f360_liabilities_workspace_due
    ON f360_liabilities (workspace_id, status, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_f360_cashea_plans_workspace_status
    ON f360_cashea_plans (workspace_id, status, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_f360_cashea_installments_due
    ON f360_cashea_installments (workspace_id, status, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_f360_merchant_sales_date
    ON f360_cashea_merchant_sales (workspace_id, sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_f360_drawers_ledger_created
    ON f360_pyme_drawers_ledger (workspace_id, drawer_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_f360_inventory_dead_stock
    ON f360_inventory_items (workspace_id, last_movement_at ASC NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_f360_quotes_workspace_status
    ON f360_quotes (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_f360_recurring_active_next
    ON f360_recurring_rules (workspace_id, is_active, next_run_date ASC);

CREATE INDEX IF NOT EXISTS idx_f360_reconciliations_vault
    ON f360_vault_reconciliations (workspace_id, vault_id, reconciled_at DESC);

-- ============================================================================
-- 6. STRICT ROW-LEVEL SECURITY (ENABLE + FORCE) ACROSS ALL F360 TABLES
-- ============================================================================

DO $$
DECLARE
    t TEXT;
    f360_tables TEXT[] := ARRAY[
        'f360_snapshots',
        'f360_vaults',
        'f360_ledger_entries',
        'f360_liabilities',
        'f360_cashea_profiles',
        'f360_cashea_plans',
        'f360_cashea_installments',
        'f360_cashea_merchant_sales',
        'f360_pyme_drawers_ledger',
        'f360_providers',
        'f360_inventory_items',
        'f360_quotes',
        'f360_goals',
        'f360_recurring_rules',
        'f360_vault_reconciliations'
    ];
BEGIN
    FOREACH t IN ARRAY f360_tables
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS workspace_silo_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY workspace_silo_isolation ON %I '
            'USING (workspace_id = NULLIF(current_setting(''app.current_workspace'', true), '''')::workspace_code) '
            'WITH CHECK (workspace_id = NULLIF(current_setting(''app.current_workspace'', true), '''')::workspace_code)',
            t
        );
    END LOOP;
END $$;

COMMIT;
