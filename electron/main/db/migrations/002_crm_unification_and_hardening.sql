-- ============================================================================
-- 002_crm_unification_and_hardening.sql
-- Idempotent PostgreSQL + pgvector hardening migration for Multi-Silo ARM/CRM
-- Silos: ARM_B2B | P2P_DESK | FINANCE_360
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Ensure canonical workspace rows exist before adding workspace FK defaults
INSERT INTO workspaces (id, display_name, accent_color_hex, default_currency, debounce_window_ms, daily_ai_budget_usd)
VALUES
    ('ARM_B2B', 'ARM Comercial B2B', '#30D158', 'USD', 3000, 15.00),
    ('P2P_DESK', 'Mesa P2P & Liquidez', '#0A84FF', 'USDT', 2000, 15.00),
    ('FINANCE_360', 'Finanzas & PyME 360', '#FFD60A', 'USD', 3000, 15.00)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 1. HARDEN EXISTING TABLES (SILO ISOLATION, VERSIONING & NUMERIC PRECISION)
-- ============================================================================

ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS workspace_id workspace_code NOT NULL DEFAULT 'P2P_DESK'
    REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- Upgrade financial and rate columns to NUMERIC(18, 6) safely & idempotently
DO $$
DECLARE
    col_rec RECORD;
    target_cols CONSTANT TEXT[][] := ARRAY[
        ARRAY['leads', 'estimated_deal_value'],
        ARRAY['catalog_items', 'unit_price'],
        ARRAY['quotes', 'subtotal'],
        ARRAY['quotes', 'discount_pct'],
        ARRAY['quotes', 'tax_amount'],
        ARRAY['quotes', 'total_amount']
    ];
    pair TEXT[];
BEGIN
    FOREACH pair SLICE 1 IN ARRAY target_cols
    LOOP
        SELECT numeric_precision, numeric_scale
        INTO col_rec
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = pair[1]
          AND column_name = pair[2];

        IF FOUND AND (col_rec.numeric_precision IS DISTINCT FROM 18 OR col_rec.numeric_scale IS DISTINCT FROM 6) THEN
            EXECUTE format(
                'ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC(18, 6) USING %I::NUMERIC(18, 6)',
                pair[1],
                pair[2],
                pair[2]
            );
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 2. MISSING CRM / ARM TREASURY, BILLING & AI TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS bank_rails (
    id VARCHAR(120) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    bank_name VARCHAR(120) NOT NULL,
    bank_code VARCHAR(32) NOT NULL DEFAULT '',
    rail_type VARCHAR(30) NOT NULL DEFAULT 'PAGO_MOVIL',
    currency VARCHAR(6) NOT NULL DEFAULT 'VES',
    holder_details_text TEXT NOT NULL DEFAULT '',
    account_number_masked VARCHAR(64) NOT NULL DEFAULT '',
    current_balance_fiat NUMERIC(18, 6) NOT NULL DEFAULT 0,
    max_daily_cap_fiat NUMERIC(18, 6) NOT NULL DEFAULT 0,
    monthly_limit_fiat NUMERIC(18, 6) NOT NULL DEFAULT 0,
    fee_pct NUMERIC(18, 6) NOT NULL DEFAULT 0,
    max_burst_tx_15m INT NOT NULL DEFAULT 5 CHECK (max_burst_tx_15m > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bank_rails
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS payment_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    bank_rail_id VARCHAR(120) NOT NULL,
    reference_code VARCHAR(120) NOT NULL,
    amount_fiat NUMERIC(18, 6) NOT NULL CHECK (amount_fiat >= 0),
    currency VARCHAR(6) NOT NULL DEFAULT 'VES',
    deal_id VARCHAR(120),
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    sender_name VARCHAR(150),
    raw_text TEXT,
    channel VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    status VARCHAR(30) NOT NULL DEFAULT 'VERIFIED'
        CHECK (status IN ('PENDING', 'VERIFIED', 'MATCHED', 'DISPUTED', 'REJECTED')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_receipt_no_replay UNIQUE (workspace_id, bank_rail_id, reference_code)
);

CREATE TABLE IF NOT EXISTS treasury_settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(120) UNIQUE NOT NULL,
    bank_rail_id VARCHAR(120),
    deal_id VARCHAR(120),
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    settlement_type VARCHAR(40) NOT NULL DEFAULT 'P2P_RELEASE',
    crypto_amount_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    fiat_amount NUMERIC(18, 6) NOT NULL DEFAULT 0,
    fiat_currency VARCHAR(6) NOT NULL DEFAULT 'VES',
    applied_rate NUMERIC(18, 6) NOT NULL DEFAULT 0,
    realized_profit_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'SETTLED'
        CHECK (status IN ('PENDING', 'SETTLED', 'FAILED', 'REVERSED')),
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    doc_number VARCHAR(64) NOT NULL,
    doc_type VARCHAR(20) NOT NULL CHECK (doc_type IN ('QUOTE', 'INVOICE', 'RECEIPT')),
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    deal_id VARCHAR(120),
    contact_name VARCHAR(150),
    contact_doc_id VARCHAR(64),
    fiat_currency VARCHAR(6) NOT NULL DEFAULT 'USD',
    exchange_rate NUMERIC(18, 6) NOT NULL DEFAULT 1.000000,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    subtotal_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    discount_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    tax_or_fee_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    total_usdt NUMERIC(18, 6) NOT NULL DEFAULT 0,
    total_fiat NUMERIC(18, 6) NOT NULL DEFAULT 0,
    payment_instructions_text TEXT,
    bank_reference_id VARCHAR(120),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SENT', 'PAID', 'CANCELLED')),
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, doc_number)
);

CREATE TABLE IF NOT EXISTS shadow_examples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    approval_id UUID REFERENCES approval_queue(id) ON DELETE SET NULL,
    agent_role agent_role NOT NULL,
    action_type approval_action_type NOT NULL,
    proposed_text TEXT NOT NULL,
    approved_text TEXT NOT NULL,
    embedding VECTOR(768),
    quality_score NUMERIC(6, 4) NOT NULL DEFAULT 1.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_cost_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'gemini',
    model VARCHAR(100) NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
    completion_tokens INT NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
    total_tokens INT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    estimated_cost_usd NUMERIC(18, 6) NOT NULL DEFAULT 0,
    operation_type VARCHAR(50) NOT NULL DEFAULT 'TURN_INFERENCE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER & REAL-TIME OUTBOX PG_NOTIFY TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_set_updated_at ON leads;
CREATE TRIGGER trg_leads_set_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_set_updated_at ON conversations;
CREATE TRIGGER trg_conversations_set_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_contacts_set_updated_at ON contacts;
CREATE TRIGGER trg_contacts_set_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_bank_rails_set_updated_at ON bank_rails;
CREATE TRIGGER trg_bank_rails_set_updated_at
    BEFORE UPDATE ON bank_rails
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_billing_documents_set_updated_at ON billing_documents;
CREATE TRIGGER trg_billing_documents_set_updated_at
    BEFORE UPDATE ON billing_documents
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION notify_arm_outbox()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('arm_outbox_channel', row_to_json(NEW)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbox_events_notify ON outbox_events;
CREATE TRIGGER trg_outbox_events_notify
    AFTER INSERT ON outbox_events
    FOR EACH ROW
    EXECUTE FUNCTION notify_arm_outbox();

-- ============================================================================
-- 4. PARTIAL, COVERING & HNSW VECTOR INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_kanban_covering
    ON leads (workspace_id, current_stage_slug, updated_at DESC)
    INCLUDE (full_name, company_name, qualification_score, estimated_deal_value, currency, is_sandbox, last_interaction_at);

CREATE INDEX IF NOT EXISTS idx_leads_antighosting
    ON leads (workspace_id, last_interaction_at ASC, next_followup_at ASC)
    WHERE is_sandbox = FALSE AND followup_attempts < 5;

CREATE INDEX IF NOT EXISTS idx_conversations_meta_window
    ON conversations (workspace_id, free_window_expires_at DESC)
    WHERE status <> 'CLOSED' AND free_window_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shadow_examples_hnsw
    ON shadow_examples USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_updated
    ON contacts (workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_rails_workspace_active
    ON bank_rails (workspace_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_workspace_verified
    ON payment_receipts (workspace_id, verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_treasury_settlements_workspace_settled
    ON treasury_settlements (workspace_id, settled_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_documents_workspace_type
    ON billing_documents (workspace_id, doc_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_cost_ledger_workspace_created
    ON ai_cost_ledger (workspace_id, created_at DESC);

-- ============================================================================
-- 5. STRICT ROW-LEVEL SECURITY (ENABLE + FORCE) ACROSS ALL 22 SILO TABLES
-- ============================================================================

DO $$
DECLARE
    t TEXT;
    scoped_tables TEXT[] := ARRAY[
        'pipeline_stages',
        'agents',
        'risk_policies',
        'catalog_items',
        'contacts',
        'contact_identities',
        'leads',
        'conversations',
        'messages',
        'lead_memories',
        'agent_runs',
        'pipeline_transitions',
        'approval_queue',
        'outbox_events',
        'quotes',
        'appointments',
        'bank_rails',
        'payment_receipts',
        'treasury_settlements',
        'billing_documents',
        'shadow_examples',
        'ai_cost_ledger'
    ];
BEGIN
    FOREACH t IN ARRAY scoped_tables
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
