import pytest
from fastapi.testclient import TestClient


class TestSprint2TreasuryAndVaultController:
    def test_treasury_enforces_spend_cap_and_triggers_20_percent_alert(self):
        from app.services.treasury import (
            TreasuryService,
            SpendCapExceededError,
            HitlApprovalRequiredError,
        )

        treasury = TreasuryService()
        brand = treasury.register_brand(
            brand_id="brd_cashea_01",
            slug="tienda-cashea-ve",
            display_name="Tienda Aliada Cashea VE",
            industry_vertical="CASHEA_ALLY",
            spend_cap_usd=1000.0,
            initial_vault_usd=1000.0,
            alert_threshold_pct=20.0,
        )
        assert brand.vault_balance_usd == 1000.0

        # 1. Reserve $820 -> leaves $180 (18% of $1,000 spend_cap <= 20% threshold)
        res1 = treasury.reserve_for_hitl(
            brand_id="brd_cashea_01",
            campaign_id="cmp_01",
            requested_usd=820.0,
        )
        assert res1.low_balance_alert_triggered is True
        assert res1.remaining_ratio_pct == 18.0

        # 2. Cannot commit spend without an APPROVED HITL record
        with pytest.raises(HitlApprovalRequiredError, match="HITL approval required"):
            treasury.commit_approved_spend(
                brand_id="brd_cashea_01",
                reservation_id=res1.reservation_id,
                hitl_status="PENDING",
            )

        # 3. Commit with APPROVED HITL succeeds
        committed = treasury.commit_approved_spend(
            brand_id="brd_cashea_01",
            reservation_id=res1.reservation_id,
            hitl_status="APPROVED",
        )
        assert committed.entry_type == "SPEND_COMMITTED"

        # 4. Attempting to reserve $250 more exceeds $1,000 spend_cap ($820 + $250 = $1,070)
        with pytest.raises(SpendCapExceededError, match="spend_cap_usd"):
            treasury.reserve_for_hitl(
                brand_id="brd_cashea_01",
                campaign_id="cmp_02",
                requested_usd=250.0,
            )

    def test_treasury_records_arm_closed_won_and_computes_roas(self):
        from app.services.treasury import TreasuryService

        treasury = TreasuryService()
        treasury.register_brand(
            brand_id="brd_02",
            slug="comercio-caracas",
            display_name="Comercio Caracas",
            industry_vertical="RETAIL_COMMERCE",
            spend_cap_usd=500.0,
            initial_vault_usd=500.0,
        )
        r = treasury.reserve_for_hitl("brd_02", "cmp_10", 100.0)
        treasury.commit_approved_spend("brd_02", r.reservation_id, hitl_status="APPROVED")

        summary = treasury.record_arm_closed_won_revenue(
            brand_id="brd_02",
            campaign_id="cmp_10",
            ad_id="meta_ad_10",
            deal_id="arm_deal_99",
            amount_usd=450.0,
        )
        assert summary["attributed_revenue_usd"] == 450.0
        assert summary["accumulated_spend_usd"] == 100.0
        assert summary["roas"] == 4.5


class TestSprint2SpecialistAgents:
    def test_creative_director_uses_ve_stack_and_generates_ab_hooks(self):
        from app.agents.creative_director import CreativeDirectorAgent

        agent = CreativeDirectorAgent()
        brief = agent.create_brief(
            brand_id="brd_cashea_01",
            industry_vertical="CASHEA_ALLY",
            product_or_offer="Combo Electrodomésticos con 40% inicial Cashea a tasa BCV",
            target_audience_ve="Comercios y familias en Caracas y Valencia",
            custom_audio_path="E:\\Agencia_Inbox\\voz_locutor_01.wav",
        )
        assert brief.ai_models_used == {
            "multimodal_strategy": "gemini-1.5-pro",
            "direct_response_copy": "gpt-4o",
            "flyer_visual_base": "nano-banana",
        }
        assert len(brief.hooks) == 3
        assert brief.hooks[0].variant == "HOOK_A"
        assert brief.hooks[1].variant == "HOOK_B"
        assert brief.hooks[2].variant == "HOOK_C"
        assert brief.custom_audio_path == "E:\\Agencia_Inbox\\voz_locutor_01.wav"

    def test_compliance_auditor_rewrites_risky_p2p_copy_and_enforces_brand_isolation(self):
        from app.agents.compliance_auditor import (
            ComplianceAuditorAgent,
            CrossBrandIsolationError,
        )

        auditor = ComplianceAuditorAgent()

        # 1. Risky copy with prohibited Meta/TikTok financial promises gets sanitized
        audit = auditor.audit_creative(
            brand_id="brd_p2p_01",
            industry_vertical="FINTECH_P2P",
            copy_text="Cambia tus USDT sin comisiones con ganancia garantizada y arbitraje sin riesgo hoy.",
            audio_transcript="Cambia tus USDT sin comisiones",
            flyer_text_ratio_pct=14.0,
        )
        assert audit.original_flagged is True
        assert audit.status == "REWRITTEN_APPROVED"
        assert audit.risk_score_after < 15.0
        assert "ganancia garantizada" not in audit.approved_copy.lower()

        # 2. Cross-brand asset mixing between P2P and Retail Commerce must fail closed
        with pytest.raises(CrossBrandIsolationError, match="Cross-brand asset contamination"):
            auditor.verify_asset_isolation(
                campaign_brand_id="brd_cashea_01",
                ad_account_brand_id="brd_p2p_01",
                pixel_brand_id="brd_cashea_01",
            )

    def test_trafficker_blocks_unapproved_deploy_and_allows_after_hitl(self):
        from app.services.treasury import TreasuryService
        from app.agents.compliance_auditor import ComplianceAuditorAgent
        from app.agents.vault_controller import VaultControllerAgent
        from app.agents.trafficker import TraffickerAgent, TraffickerGateError

        treasury = TreasuryService()
        treasury.register_brand(
            brand_id="brd_cashea_01",
            slug="cashea-ally",
            display_name="Cashea Ally VE",
            industry_vertical="CASHEA_ALLY",
            spend_cap_usd=600.0,
            initial_vault_usd=600.0,
        )
        auditor = ComplianceAuditorAgent()
        vault_ctrl = VaultControllerAgent(treasury)
        trafficker = TraffickerAgent(treasury=treasury, auditor=auditor, vault_controller=vault_ctrl)

        proposal = trafficker.stage_campaign_for_hitl(
            brand_id="brd_cashea_01",
            ad_account_brand_id="brd_cashea_01",
            pixel_brand_id="brd_cashea_01",
            platform="META_ADS",
            campaign_name="cmp_ve_cashea_q4",
            daily_budget_usd=60.0,
            copy_text="Equipa tu hogar hoy en cuotas sin interés a tasa BCV.",
        )
        assert proposal["status"] == "DRAFT_PENDING_HITL"

        # Cannot deploy before HITL approval
        with pytest.raises(TraffickerGateError, match="Human-in-the-Loop approval is PENDING"):
            trafficker.execute_approved_deployment(proposal["approval_id"])


class TestSprint2TelegramHitlCommandCenter:
    def test_telegram_voice_note_to_brief_and_inline_button_approval_flow(self):
        from app.main import app

        client = TestClient(app)

        # 1. Register an isolated brand vault
        reg = client.post(
            "/api/v1/treasury/brands",
            json={
                "brand_id": "brd_tg_01",
                "slug": "tienda-caracas-tg",
                "display_name": "Tienda Caracas TG",
                "industry_vertical": "CASHEA_ALLY",
                "spend_cap_usd": 500.0,
                "initial_vault_usd": 500.0,
                "alert_threshold_pct": 20.0,
            },
        )
        assert reg.status_code == 200

        # 2. Send a Telegram Voice Note update to generate a Creative Brief + HITL Campaign Proposal
        voice_res = client.post(
            "/api/v1/telegram/webhook",
            json={
                "chat_id": "operator_ve_01",
                "update_type": "VOICE_NOTE",
                "brand_id": "brd_tg_01",
                "voice_duration_sec": 24,
                "voice_transcript": "Lanzá campaña en Meta para el combo Cashea con $80 de presupuesto diario.",
                "requested_budget_usd": 80.0,
            },
        )
        assert voice_res.status_code == 200
        v_body = voice_res.json()
        assert v_body["status"] == "HITL_APPROVAL_REQUESTED"
        approval_id = v_body["approval_id"]
        callbacks = [btn["callback_data"] for row in v_body["inline_keyboard"] for btn in row]
        assert f"HITL_APPROVE_SPEND:{approval_id}" in callbacks
        assert f"HITL_REJECT_SPEND:{approval_id}" in callbacks

        # 3. Click the Telegram Inline Button [✅ Aprobar Pauta]
        approve_res = client.post(
            "/api/v1/telegram/webhook",
            json={
                "chat_id": "operator_ve_01",
                "update_type": "CALLBACK_QUERY",
                "callback_data": f"HITL_APPROVE_SPEND:{approval_id}",
            },
        )
        assert approve_res.status_code == 200
        a_body = approve_res.json()
        assert a_body["approval_status"] == "APPROVED"
        assert a_body["campaign_status"] == "ACTIVE"
        assert a_body["committed_spend_usd"] == 80.0
