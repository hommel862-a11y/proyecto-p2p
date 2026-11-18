-- ============================================================================
-- 001_init_arm_schema.sql (v2 Hardened Multi-Workspace ARM Migration)
-- Architecture: Strict Multi-Silo Isolation (ARM_B2B | P2P_DESK | FINANCE_360)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- 1. ENUMERATED TYPES (ARM DOMAIN)
-- ============================================================================
CREATE TYPE workspace_code AS ENUM ('ARM_B2B', 'P2P_DESK', 'FINANCE_360');
CREATE TYPE agent_role AS ENUM ('ROUTER', 'SDR_QUALIFIER', 'QUOTER', 'SCHEDULER', 'FOLLOW_UP');
CREATE TYPE actor_type AS ENUM ('AGENT', 'HUMAN', 'SYSTEM');
CREATE TYPE conversation_status AS ENUM ('AUTOPILOT', 'HUMAN_TAKEOVER', 'WAITING_APPROVAL', 'CLOSED');
CREATE TYPE approval_status AS ENUM ('PENDING', 'APPROVED', 'EDITED_AND_APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE approval_action_type AS ENUM (
    'SEND_QUOTE',
    'APPLY_DISCOUNT',
    'SEND_FOLLOWUP',
    'BOOK_CUSTOM_MEETING',
    'STAGE_OVERRIDE',
    'P2P_SETTLEMENT_RELEASE'
);

-- ============================================================================
-- 2. MULTI-WORKSPACE SILO REGISTRY (ZERO CROSS-CONTAMINATION)
-- ============================================================================
CREATE TABLE workspaces (
    id workspace_code PRIMARY KEY,
    display_name VARCHAR(120) NOT NULL,
    accent_color_hex VARCHAR(7) NOT NULL DEFAULT '#30D158',
    meta_phone_number_id VARCHAR(100) UNIQUE,
    ig_business_account_id VARCHAR(100) UNIQUE,
    default_currency VARCHAR(4) NOT NULL DEFAULT 'USD',
    debounce_window_ms INT NOT NULL DEFAULT 3000,
    daily_ai_budget_usd NUMERIC(8, 2) NOT NULL DEFAULT 15.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 3. PIPELINE STAGES, AGENTS, RISK POLICIES & CATALOG (SCOPED BY WORKSPACE)
-- ============================================================================
CREATE TABLE pipeline_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    position INT NOT NULL,
    color_hex VARCHAR(7) DEFAULT '#30D158',
    entry_criteria_prompt TEXT,
    requires_quote BOOLEAN NOT NULL DEFAULT FALSE,
    requires_appointment BOOLEAN NOT NULL DEFAULT FALSE,
    requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, slug)
);

CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    role agent_role NOT NULL,
    avatar_url TEXT,
    llm_provider VARCHAR(50) NOT NULL DEFAULT 'gemini',
    llm_model VARCHAR(100) NOT NULL DEFAULT 'gemini-3.7-flash',
    temperature NUMERIC(3, 2) NOT NULL DEFAULT 0.20,
    system_prompt TEXT NOT NULL,
    enabled_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_threshold INT NOT NULL DEFAULT 85 CHECK (confidence_threshold BETWEEN 0 AND 100),
    enable_google_search BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, role)
);

CREATE TABLE risk_policies (
    workspace_id workspace_code PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    max_auto_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    max_auto_quote_amount NUMERIC(12, 2) NOT NULL DEFAULT 1500.00,
    require_human_for_settlement BOOLEAN NOT NULL DEFAULT TRUE,
    max_followup_attempts INT NOT NULL DEFAULT 3,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sku VARCHAR(64) NOT NULL,
    description VARCHAR(250) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    currency VARCHAR(4) NOT NULL DEFAULT 'USD',
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'ONE_TIME', -- 'MONTHLY', 'ANNUAL', 'ONE_TIME'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, sku)
);

-- ============================================================================
-- 4. CONTACTS, OMNICHANNEL IDENTITIES & PIPELINE DEALS (LEADS)
-- ============================================================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150),
    company_name VARCHAR(150),
    phone_whatsapp VARCHAR(30),
    email VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contact_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP', -- 'WHATSAPP', 'INSTAGRAM', 'WEBCHAT'
    external_user_id VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, channel, external_user_id)
);

CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    full_name VARCHAR(150),
    company_name VARCHAR(150),
    phone_whatsapp VARCHAR(30),
    email VARCHAR(150),
    current_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    current_stage_slug VARCHAR(100) NOT NULL DEFAULT 'nuevo',
    assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    assigned_human_id UUID,
    qualification_score INT NOT NULL DEFAULT 0 CHECK (qualification_score BETWEEN 0 AND 100),
    is_qualified BOOLEAN,
    substantive_turns_count INT NOT NULL DEFAULT 0,
    bant_data JSONB NOT NULL DEFAULT '{
        "budget": null,
        "authority": null,
        "need_pain_point": null,
        "timeline": null
    }'::jsonb,
    ai_executive_summary TEXT,
    estimated_deal_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(4) NOT NULL DEFAULT 'USD',
    followup_attempts INT NOT NULL DEFAULT 0,
    next_followup_at TIMESTAMPTZ,
    is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
    last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. CONVERSATIONS, MESSAGES, MULTIMODAL & HYBRID MEMORY
-- ============================================================================
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
    external_thread_id VARCHAR(150),
    status conversation_status NOT NULL DEFAULT 'AUTOPILOT',
    active_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    free_window_expires_at TIMESTAMPTZ,
    processing_locked_until TIMESTAMPTZ,
    unread_count INT NOT NULL DEFAULT 0,
    last_message_preview TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    channel VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
    sender_type actor_type NOT NULL,
    is_inbound BOOLEAN NOT NULL DEFAULT TRUE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    content TEXT,
    media_id VARCHAR(150),
    media_mime_type VARCHAR(80),
    media_url TEXT,
    tool_calls JSONB,
    tokens_used INT NOT NULL DEFAULT 0,
    latency_ms INT,
    external_message_id VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, channel, external_message_id)
);

CREATE TABLE lead_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    extracted_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('PAIN_POINT', 'OBJECTION', 'PREFERENCE', 'TECH_STACK')),
    fact TEXT NOT NULL,
    embedding VECTOR(768),
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 1.000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 6. AGENT RUNS (AGENT LOGS), PIPELINE TRANSITIONS, APPROVAL QUEUE & OUTBOX
-- ============================================================================
CREATE TABLE agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    agent_role agent_role NOT NULL,
    tool_name VARCHAR(100),
    tool_arguments JSONB,
    tool_result JSONB,
    tokens_used INT NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'BLOCKED_HITL', 'ERROR'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pipeline_transitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    to_stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
    from_stage_slug VARCHAR(100),
    to_stage_slug VARCHAR(100) NOT NULL,
    triggered_by_type actor_type NOT NULL,
    triggered_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    trigger_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    reasoning TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(150) UNIQUE NOT NULL,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    requested_by_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    requested_by_role agent_role NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    action_type approval_action_type NOT NULL,
    title VARCHAR(200) NOT NULL,
    agent_reasoning TEXT NOT NULL,
    risk_rule_triggered VARCHAR(150) NOT NULL,
    proposed_payload JSONB NOT NULL,
    final_approved_payload JSONB,
    save_as_example BOOLEAN NOT NULL DEFAULT FALSE,
    confidence_score INT CHECK (confidence_score BETWEEN 0 AND 100),
    priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    status approval_status NOT NULL DEFAULT 'PENDING',
    reviewed_by_human_id UUID,
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL, -- 'pipeline_transition', 'approval_requested', 'message_received', 'agent_run'
    aggregate_id VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 7. COMMERCIAL EXECUTION: QUOTES & APPOINTMENTS
-- ============================================================================
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    quote_number VARCHAR(50) UNIQUE NOT NULL,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    approval_id UUID REFERENCES approval_queue(id) ON DELETE SET NULL,
    items JSONB NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(4) NOT NULL DEFAULT 'USD',
    payment_terms VARCHAR(120) DEFAULT '100% Contado',
    pdf_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id workspace_code NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    booked_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    meeting_link TEXT,
    calendar_external_id VARCHAR(150),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    client_timezone VARCHAR(64) NOT NULL DEFAULT 'America/Caracas',
    status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
    briefing_for_human TEXT NOT NULL,
    briefing_dispatched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 8. HIGH-PERFORMANCE INDEXES (DASHBOARD, SSE CURSOR & HNSW VECTOR RAG)
-- ============================================================================
CREATE INDEX idx_leads_workspace_stage ON leads(workspace_id, current_stage_slug);
CREATE INDEX idx_leads_bant_gin ON leads USING GIN (bant_data);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_approval_pending ON approval_queue(workspace_id, status, priority, created_at DESC) WHERE status = 'PENDING';
CREATE INDEX idx_transitions_lead ON pipeline_transitions(workspace_id, lead_id, created_at DESC);
CREATE INDEX idx_outbox_cursor ON outbox_events(workspace_id, id ASC);
CREATE INDEX idx_lead_memories_hnsw ON lead_memories USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- 9. SEED: 3 ISOLATED WORKSPACES & RISK POLICIES
-- ============================================================================
INSERT INTO workspaces (id, display_name, accent_color_hex, default_currency, debounce_window_ms, daily_ai_budget_usd)
VALUES
    ('ARM_B2B', 'ARM Comercial B2B', '#30D158', 'USD', 3000, 15.00),
    ('P2P_DESK', 'Mesa P2P & Liquidez', '#0A84FF', 'USDT', 2000, 15.00),
    ('FINANCE_360', 'Finanzas & PyME 360', '#FFD60A', 'USD', 3000, 15.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO risk_policies (workspace_id, max_auto_discount_pct, max_auto_quote_amount, require_human_for_settlement, max_followup_attempts)
VALUES
    ('ARM_B2B', 0.00, 1500.00, TRUE, 3),
    ('P2P_DESK', 0.00, 500.00, TRUE, 2),
    ('FINANCE_360', 5.00, 1200.00, TRUE, 3)
ON CONFLICT (workspace_id) DO NOTHING;
