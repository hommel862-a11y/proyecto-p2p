import io
from pathlib import Path
import pytest
from fastapi.testclient import TestClient


class TestRealSqlitePersistenceAndConnections:
    def test_sqlite_persists_brands_and_encrypted_connections_across_restarts(self, tmp_path):
        from app.core.database import AgenciaSqliteStore
        from app.core.security import BrandCredentialVault, SecurityViolationError

        db_path = tmp_path / "agencia360.db"
        vault = BrandCredentialVault(master_secret="test-real-master-vault-secret-32b!!")

        # Instance 1 writes brand + encrypted Gemini & Meta credentials
        store1 = AgenciaSqliteStore(db_path=db_path, credential_vault=vault)
        brand = store1.create_brand(
            brand_id="brd_real_01",
            slug="mi-marca-real",
            display_name="Mi Marca Real",
            industry_vertical="RETAIL_COMMERCE",
            spend_cap_usd=300.0,
            vault_balance_usd=0.0,
            card_label="Wally Virtual USD",
            card_last4="4821",
        )
        assert brand["vault_balance_usd"] == 0.0
        assert brand["card_last4"] == "4821"

        store1.save_connection(
            scope_id="GLOBAL",
            provider="GEMINI_API",
            secret_token="AIzaSy_REAL_GEMINI_KEY_TEST",
            metadata={"text_model": "gemini-3.8-flash", "video_model": "gemini-omni-1.2-flash"},
        )
        store1.save_connection(
            scope_id="brd_real_01",
            provider="META_ADS",
            secret_token="EAA_REAL_META_SYSTEM_TOKEN",
            metadata={"ad_account_id": "act_123456", "page_id": "pg_999", "whatsapp_phone": "+584121234567"},
        )

        # Instance 2 simulates full server restart — data MUST persist
        store2 = AgenciaSqliteStore(db_path=db_path, credential_vault=vault)
        brands = store2.list_brands()
        assert len(brands) == 1
        assert brands[0]["display_name"] == "Mi Marca Real"
        assert brands[0]["vault_balance_usd"] == 0.0

        gemini_secret, gemini_meta = store2.get_decrypted_connection("GLOBAL", "GEMINI_API")
        assert gemini_secret == "AIzaSy_REAL_GEMINI_KEY_TEST"
        assert gemini_meta["video_model"] == "gemini-omni-1.2-flash"

        # Encrypted Meta token cannot be read by another brand
        meta_secret, _ = store2.get_decrypted_connection("brd_real_01", "META_ADS")
        assert meta_secret == "EAA_REAL_META_SYSTEM_TOKEN"
        with pytest.raises(SecurityViolationError):
            vault.decrypt_for_brand("brd_other_02", store2.get_raw_ciphertext("brd_real_01", "META_ADS"))


class TestRealMediaVaultAndGenAi2026Models:
    def test_media_upload_and_google_flow_watch_folder(self, tmp_path):
        from app.services.media_vault import MediaVaultService

        storage_root = tmp_path / "storage"
        inbox_root = tmp_path / "Agencia_Inbox"
        flow_dir = inbox_root / "flow_exports"
        flow_dir.mkdir(parents=True)

        # Simulate a real .mp4 exported from Google Flow
        flow_clip = flow_dir / "flow_scene_producto_916.mp4"
        flow_clip.write_bytes(b"\x00\x00\x00\x18ftypmp42")

        vault_svc = MediaVaultService(storage_root=storage_root, inbox_root=inbox_root)
        saved = vault_svc.save_uploaded_asset(
            brand_id="brd_real_01",
            brand_slug="mi-marca-real",
            category="photos",
            original_filename="producto_estrella.png",
            content_bytes=b"\x89PNG\r\n\x1a\nfake_png_bytes",
        )
        assert Path(saved["local_path"]).exists()
        assert saved["category"] == "photos"
        assert saved["relative_url"].startswith("/api/v1/media/files/mi-marca-real/photos/")

        flow_items = vault_svc.scan_google_flow_exports()
        assert len(flow_items) == 1
        assert flow_items[0]["filename"] == "flow_scene_producto_916.mp4"

    def test_genai_engine_uses_current_2026_models_never_legacy_15(self):
        from app.services.genai_engines import GENAI_2026_MODELS

        assert GENAI_2026_MODELS["multimodal_brain"] == "gemini-3.8-flash"
        assert GENAI_2026_MODELS["image_nano_banana"] == "gemini-nano-banana-2.1"
        assert GENAI_2026_MODELS["video_omni"] == "gemini-omni-1.2-flash"
        assert GENAI_2026_MODELS["transcribe"] == "gemini-3.5-transcribe"
        assert "1.5" not in str(GENAI_2026_MODELS)


class TestMetaCtwaLauncherAndCardMirrorKillSwitch:
    def test_ctwa_5step_plan_and_card_billing_killswitch_thresholds(self):
        from app.integrations.meta_ctwa_billing import (
            build_ctwa_5step_plan,
            evaluate_card_mirror_killswitch,
        )

        plan = build_ctwa_5step_plan(
            brand_id="brd_real_01",
            ad_account_id="act_123456",
            page_id="pg_999",
            whatsapp_phone="+584121234567",
            campaign_name="Promo Caracas CTWA",
            daily_budget_usd=25.0,
            video_public_url="https://cdn.example.com/reel.mp4",
            copy_text="Escríbenos por WhatsApp y recibe atención inmediata.",
            tracking_code="AD-REAL-01",
        )
        assert len(plan["steps"]) == 5
        assert plan["steps"][2]["payload"]["destination_type"] == "WHATSAPP"
        assert plan["steps"][2]["payload"]["optimization_goal"] == "CONVERSATIONS"
        assert "[AD-REAL-01]" in plan["steps"][3]["payload"]["prefilled_whatsapp_message"]
        assert plan["steps"][4]["payload"]["status"] == "PAUSED"

        # Card Mirror Kill-Switch checks
        safe = evaluate_card_mirror_killswitch(card_funded_usd=200.0, meta_amount_spent_usd=100.0)
        assert safe["action"] == "SAFE"

        warn = evaluate_card_mirror_killswitch(card_funded_usd=200.0, meta_amount_spent_usd=165.0)
        assert warn["action"] == "ALERT_RECHARGE_CARD"
        assert warn["consumed_pct"] == 82.5

        kill = evaluate_card_mirror_killswitch(card_funded_usd=200.0, meta_amount_spent_usd=192.0)
        assert kill["action"] == "AUTO_PAUSE_KILLSWITCH"
        assert kill["should_pause_active_adsets"] is True


class TestFastApiOverhaulEndpoints:
    def test_zero_seed_brands_connections_upload_and_ctwa_api_endpoints(self, tmp_path, monkeypatch):
        import app.main as main_mod

        client = TestClient(main_mod.app)

        # 1. Upload a real photo via multipart/form-data
        upload_res = client.post(
            "/api/v1/media/upload",
            data={"brand_id": "brd_api_01", "brand_slug": "marca-api", "category": "photos"},
            files={"file": ("foto_prod.png", io.BytesIO(b"\x89PNG\r\n\x1a\ndata"), "image/png")},
        )
        assert upload_res.status_code == 200
        uploaded = upload_res.json()
        assert uploaded["relative_url"].startswith("/api/v1/media/files/marca-api/photos/")

        # 2. Fetch the uploaded file back over HTTP
        file_res = client.get(uploaded["relative_url"])
        assert file_res.status_code == 200
        assert file_res.content.startswith(b"\x89PNG")

        # 3. Save & inspect masked API connection (never returns plaintext secret!)
        conn_res = client.post(
            "/api/v1/connections",
            json={
                "scope_id": "GLOBAL",
                "provider": "GEMINI_API",
                "secret_token": "AIzaSy_SECRET_NEVER_EXPOSE_9999",
                "metadata": {"video_model": "gemini-omni-1.2-flash"},
            },
        )
        assert conn_res.status_code == 200
        assert "AIzaSy_SECRET_NEVER_EXPOSE_9999" not in conn_res.text
        assert conn_res.json()["configured"] is True

        # 4. Evaluate Card Mirror Kill-Switch endpoint
        ks_res = client.post(
            "/api/v1/billing/card-killswitch/evaluate",
            json={"card_funded_usd": 100.0, "meta_amount_spent_usd": 96.0},
        )
        assert ks_res.status_code == 200
        assert ks_res.json()["action"] == "AUTO_PAUSE_KILLSWITCH"
