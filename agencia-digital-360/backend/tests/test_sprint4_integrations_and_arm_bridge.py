import json
import pytest
from fastapi.testclient import TestClient


class TestSprint4MultiPlatformAdIntegrations:
    def test_meta_integration_enforces_brand_vault_and_builds_capi_purchase_with_hashed_pii(self):
        from app.core.security import BrandCredentialVault, SecurityViolationError
        from app.integrations.meta_ads import MetaAdsIntegration

        vault = BrandCredentialVault(master_secret="sprint4-vault-master-secret-32b!!")
        enc_token_cashea = vault.encrypt_for_brand("brd_cashea_01", "EAA_CASHEA_META_TOKEN")
        enc_token_p2p = vault.encrypt_for_brand("brd_p2p_01", "EAA_P2P_META_TOKEN")

        meta = MetaAdsIntegration(credential_vault=vault)

        # 1. Valid per-brand campaign creation
        campaign_payload = meta.build_916_reel_campaign_payload(
            brand_id="brd_cashea_01",
            ad_account_id="act_44198201",
            page_id="pg_9911",
            pixel_id="px_902",
            encrypted_access_token=enc_token_cashea,
            campaign_name="cmp_ve_cashea_q4",
            daily_budget_usd=45.0,
            video_public_https_url="https://cdn.agencia360.ve/public/brands/cashea/videos/v1.mp4",
            copy_text="Equipa tu hogar hoy a tasa BCV.",
        )
        assert campaign_payload["ad_account_id"] == "act_44198201"
        assert campaign_payload["daily_budget_cents"] == 4500

        # 2. Cross-brand token reuse (P2P token on Cashea brand) must fail closed
        with pytest.raises(SecurityViolationError, match="Brand asset isolation violation"):
            meta.build_916_reel_campaign_payload(
                brand_id="brd_cashea_01",
                ad_account_id="act_44198201",
                page_id="pg_9911",
                pixel_id="px_902",
                encrypted_access_token=enc_token_p2p,
                campaign_name="cmp_cross_leak",
                daily_budget_usd=45.0,
                video_public_https_url="https://cdn.agencia360.ve/public/brands/cashea/videos/v1.mp4",
                copy_text="Leak attempt",
            )

        # 3. Server-side CAPI Purchase event hashes phone with SHA-256
        capi = meta.build_capi_purchase_event(
            brand_id="brd_cashea_01",
            pixel_id="px_902",
            deal_id="arm_deal_771",
            ad_id="meta_9042_hookA",
            amount_usd=185.0,
            contact_phone="+584129014421",
            ctwa_clid="ctwa_abc_123",
        )
        event_data = capi["data"][0]
        assert event_data["event_name"] == "Purchase"
        assert event_data["custom_data"]["value"] == 185.0
        assert event_data["custom_data"]["currency"] == "USD"
        assert event_data["custom_data"]["ad_id"] == "meta_9042_hookA"
        # Raw phone number must never appear in CAPI user_data
        assert "+584129014421" not in json.dumps(event_data["user_data"])
        assert len(event_data["user_data"]["ph"][0]) == 64

    def test_tiktok_and_youtube_v3_isolated_builders(self):
        from app.integrations.tiktok_ads import TikTokAdsIntegration
        from app.integrations.youtube_v3 import YouTubeDataV3Integration

        tt = TikTokAdsIntegration()
        tt_payload = tt.build_916_video_ad_payload(
            brand_id="brd_cashea_01",
            advertiser_id="tt_adv_9912",
            campaign_name="tt_cashea_ve",
            daily_budget_usd=30.0,
            video_public_https_url="https://cdn.agencia360.ve/public/brands/cashea/videos/v1.mp4",
        )
        assert tt_payload["advertiser_id"] == "tt_adv_9912"
        assert tt_payload["placement_type"] == "PLACEMENT_TIKTOK_9_16"

        yt = YouTubeDataV3Integration()
        yt_payload = yt.build_shorts_upload_payload(
            brand_id="brd_cashea_01",
            channel_id="yt_ch_881",
            title="Combo Cashea Tasa BCV",
            description="Solicita tu cotización",
            campaign_id="cmp_yt_01",
            ad_id="yt_short_01",
        )
        assert "#Shorts" in yt_payload["snippet"]["title"]
        assert "utm_campaign=cmp_yt_01" in yt_payload["snippet"]["description"]


class TestSprint4DecoupledArmWebhookBridge:
    def test_inbound_arm_closed_won_webhook_verifies_hmac_deduplicates_and_fires_capi(self):
        from app.main import app
        from app.core.config import get_settings
        from app.core.security import sign_arm_webhook_payload

        client = TestClient(app)
        settings = get_settings()

        # 1. Register brand and commit $100 spend so ROAS can be calculated
        client.post(
            "/api/v1/treasury/brands",
            json={
                "brand_id": "brd_arm_01",
                "slug": "cashea-arm-bridge",
                "display_name": "Cashea ARM Bridge",
                "industry_vertical": "CASHEA_ALLY",
                "spend_cap_usd": 500.0,
                "initial_vault_usd": 500.0,
            },
        )
        voice = client.post(
            "/api/v1/telegram/webhook",
            json={
                "chat_id": "op_01",
                "update_type": "VOICE_NOTE",
                "brand_id": "brd_arm_01",
                "voice_transcript": "Campaña Cashea Meta",
                "requested_budget_usd": 100.0,
            },
        ).json()
        client.post(
            "/api/v1/telegram/webhook",
            json={
                "chat_id": "op_01",
                "update_type": "CALLBACK_QUERY",
                "callback_data": f"HITL_APPROVE_SPEND:{voice['approval_id']}",
            },
        )

        # 2. Construct signed inbound ARM closed_won webhook
        payload_dict = {
            "event": "closed_won",
            "idempotency_key": "idem_arm_deal_8841_v1",
            "brand_id": "brd_arm_01",
            "deal_id": "arm_deal_8841",
            "campaign_id": voice["campaign_id"],
            "ad_id": "meta_9042_hookA",
            "amount_usd": 350.0,
            "currency_original": "USD",
            "trigger_server_side_capi": True,
        }
        raw_body = json.dumps(payload_dict).encode("utf-8")
        ts = 1795450500
        sig = sign_arm_webhook_payload(
            raw_body,
            secret=settings.arm_webhook_hmac_secret,
            timestamp=ts,
        )

        res = client.post(
            "/api/v1/webhooks/arm-conversion",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Agencia360-Signature": sig,
                "X-Agencia360-Timestamp": str(ts),
                "X-Idempotency-Key": "idem_arm_deal_8841_v1",
                "X-Test-Now-Epoch": str(ts + 10),
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "PROCESSED"
        assert body["roas"] == 3.5
        assert body["capi_purchase_dispatched"] is True
        assert body["capi_event"]["data"][0]["event_name"] == "Purchase"

        # 3. Duplicate webhook with same idempotency_key returns DUPLICATE_IGNORED without double-counting ROAS
        dup = client.post(
            "/api/v1/webhooks/arm-conversion",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Agencia360-Signature": sig,
                "X-Agencia360-Timestamp": str(ts),
                "X-Idempotency-Key": "idem_arm_deal_8841_v1",
                "X-Test-Now-Epoch": str(ts + 15),
            },
        )
        assert dup.status_code == 200
        assert dup.json()["status"] == "DUPLICATE_IGNORED"

        # 4. Tampered signature must be rejected with 401
        bad = client.post(
            "/api/v1/webhooks/arm-conversion",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Agencia360-Signature": "sha256=0000000000",
                "X-Agencia360-Timestamp": str(ts),
                "X-Idempotency-Key": "idem_arm_deal_tampered",
                "X-Test-Now-Epoch": str(ts + 15),
            },
        )
        assert bad.status_code == 401
