-- ============================================================================
-- AGENCIA DIGITAL 360 (Execution Module) — PostgreSQL 17 / Supabase Schema
-- Architectural Constraint #1: 100% Decoupled from ARM Core Database
-- Architectural Constraint #2: Strict Brand Asset Isolation (Compliance P2P/Commerce)
-- Timezone: America/Caracas (VET, UTC-04:00)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SET TIME ZONE 'America/Caracas';

-- 1. Isolated Brands Table (Per-Brand Credentials, Ad Accounts, Pixels & Spend Caps)
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    industry_vertical VARCHAR(32) NOT NULL CHECK (industry_vertical IN ('RETAIL_COMMERCE', 'CASHEA_ALLY', 'FINTECH_P2P', 'B2B_SERVICES', 'EDUCATION')),
    compliance_tier VARCHAR(24) NOT NULL DEFAULT 'STRICT_ISOLATED' CHECK (compliance_tier IN ('STANDARD', 'STRICT_ISOLATED', 'HIGH_RISK_P2P')),
    meta_ad_account_id VARCHAR(64),
    meta_page_id VARCHAR(64),
    meta_pixel_id VARCHAR(64),
    meta_access_token_enc TEXT,
    meta_capi_token_enc TEXT,
    tiktok_advertiser_id VARCHAR(64),
    tiktok_access_token_enc TEXT,
    youtube_channel_id VARCHAR(64),
    youtube_refresh_token_enc TEXT,
    storage_bucket_prefix VARCHAR(128) NOT NULL UNIQUE,
    vault_balance_usd NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (vault_balance_usd >= 0),
    spend_cap_usd NUMERIC(14, 2) NOT NULL DEFAULT 500.00 CHECK (spend_cap_usd > 0),
    accumulated_spend_usd NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (accumulated_spend_usd >= 0),
    alert_threshold_pct NUMERIC(5, 2) NOT NULL DEFAULT 20.00 CHECK (alert_threshold_pct BETWEEN 5.00 AND 50.00),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Creative Briefs (Gemini Pro Multimodal + OpenAI Copy + A/B/C Hooks)
CREATE TABLE IF NOT EXISTS creative_briefs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    title VARCHAR(160) NOT NULL,
    source_channel VARCHAR(24) NOT NULL DEFAULT 'DASHBOARD' CHECK (source_channel IN ('DASHBOARD', 'TELEGRAM_VOICE', 'TELEGRAM_TEXT')),
    product_or_offer TEXT NOT NULL,
    target_audience_ve TEXT NOT NULL,
    hook_variant_a TEXT NOT NULL,
    hook_variant_b TEXT,
    hook_variant_c TEXT,
    direct_response_copy TEXT NOT NULL,
    custom_audio_path TEXT,
    compliance_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (compliance_status IN ('PENDING', 'APPROVED', 'REWRITTEN_APPROVED', 'REJECTED')),
    compliance_risk_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    compliance_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Media Assets (MoneyPrinterTurbo 9:16 Videos, Surgical Viral Clips, Nano Banana Flyers)
CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    brief_id UUID REFERENCES creative_briefs(id) ON DELETE SET NULL,
    asset_type VARCHAR(32) NOT NULL CHECK (asset_type IN ('VIDEO_MPT_916', 'VIRAL_CLIP_LOCAL', 'VIRAL_CLIP_YOUTUBE', 'FLYER_NANO_BANANA')),
    aspect_ratio VARCHAR(10) NOT NULL DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '4:5', '1:1', '16:9')),
    hook_label VARCHAR(16) NOT NULL DEFAULT 'HOOK_A',
    source_origin TEXT,
    custom_audio_used BOOLEAN NOT NULL DEFAULT TRUE,
    whisper_subtitles_srt TEXT,
    public_https_url TEXT,
    render_status VARCHAR(24) NOT NULL DEFAULT 'QUEUED' CHECK (render_status IN ('QUEUED', 'RENDERING', 'COMPLETED', 'FAILED')),
    worker_concurrency_slot SMALLINT NOT NULL DEFAULT 1 CHECK (worker_concurrency_slot = 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Campaigns (Meta / TikTok / YouTube Pauta Execution)
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    brief_id UUID REFERENCES creative_briefs(id) ON DELETE SET NULL,
    media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
    platform VARCHAR(24) NOT NULL CHECK (platform IN ('META_ADS', 'TIKTOK_ADS', 'YOUTUBE_ADS')),
    external_campaign_id VARCHAR(128),
    external_ad_id VARCHAR(128) UNIQUE,
    campaign_name VARCHAR(160) NOT NULL,
    daily_budget_usd NUMERIC(12, 2) NOT NULL CHECK (daily_budget_usd > 0),
    campaign_spend_cap_usd NUMERIC(12, 2) NOT NULL CHECK (campaign_spend_cap_usd >= daily_budget_usd),
    spent_usd NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (spent_usd >= 0),
    attributed_revenue_usd NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (attributed_revenue_usd >= 0),
    closed_won_count INTEGER NOT NULL DEFAULT 0 CHECK (closed_won_count >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT_PENDING_HITL' CHECK (status IN ('DRAFT_PENDING_HITL', 'APPROVED_QUEUED', 'ACTIVE', 'PAUSED_BY_VAULT', 'PAUSED_BY_OPERATOR', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Ad Treasury Ledger (Double-Entry Spend Control & 20% Low-Balance Alert Trail)
CREATE TABLE IF NOT EXISTS ad_treasury_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    entry_type VARCHAR(32) NOT NULL CHECK (entry_type IN ('VAULT_TOPUP', 'HITL_RESERVATION', 'SPEND_COMMITTED', 'RESERVATION_RELEASED', 'ARM_CLOSED_WON_RETURN', 'LOW_BALANCE_20PCT_ALERT')),
    amount_usd NUMERIC(14, 2) NOT NULL,
    balance_after_usd NUMERIC(14, 2) NOT NULL CHECK (balance_after_usd >= 0),
    remaining_ratio_pct NUMERIC(5, 2) NOT NULL,
    low_balance_alert_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    reference_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Human-in-the-Loop (HITL) Approval Queue (Dashboard & Telegram Inline Buttons)
CREATE TABLE IF NOT EXISTS hitl_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    target_type VARCHAR(24) NOT NULL CHECK (target_type IN ('AD_SPEND_DEPLOY', 'BULK_VIDEO_RENDER', 'CAMPAIGN_KILLSWITCH')),
    target_id UUID NOT NULL,
    requested_budget_usd NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    telegram_message_id VARCHAR(64),
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
    decided_by VARCHAR(64),
    decided_via VARCHAR(24) CHECK (decided_via IN ('DASHBOARD', 'TELEGRAM_INLINE')),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Decoupled ARM Attribution Events Log (Outbound ad_id/campaign_id & Inbound closed_won)
CREATE TABLE IF NOT EXISTS arm_attribution_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('OUTBOUND_TO_ARM', 'INBOUND_FROM_ARM')),
    event_name VARCHAR(48) NOT NULL CHECK (event_name IN ('ad_lead_attributed', 'closed_won')),
    external_ad_id VARCHAR(128) NOT NULL,
    external_campaign_id VARCHAR(128) NOT NULL,
    arm_lead_or_deal_id VARCHAR(128),
    revenue_usd NUMERIC(14, 2) DEFAULT 0.00,
    capi_purchase_dispatched BOOLEAN NOT NULL DEFAULT FALSE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce Row-Level Security (RLS) per Brand ID so P2P & Commerce assets never mix
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_treasury_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE arm_attribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_isolation_policy_briefs ON creative_briefs
    USING (brand_id::text = COALESCE(current_setting('app.current_brand_id', true), brand_id::text));

CREATE POLICY brand_isolation_policy_assets ON media_assets
    USING (brand_id::text = COALESCE(current_setting('app.current_brand_id', true), brand_id::text));

CREATE POLICY brand_isolation_policy_campaigns ON campaigns
    USING (brand_id::text = COALESCE(current_setting('app.current_brand_id', true), brand_id::text));

CREATE POLICY brand_isolation_policy_treasury ON ad_treasury_ledger
    USING (brand_id::text = COALESCE(current_setting('app.current_brand_id', true), brand_id::text));
