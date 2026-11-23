from pathlib import Path
from fastapi.testclient import TestClient


class TestSprint6FullApiEndToEndWiring:
    def test_cors_headers_allow_angular_spa(self):
        from app.main import app

        client = TestClient(app)
        res = client.options(
            "/api/v1/health",
            headers={
                "Origin": "http://localhost:4200",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert res.status_code == 200
        assert res.headers.get("access-control-allow-origin") == "http://localhost:4200"

    def test_live_brands_list_brief_generation_flyer_viral_clips_and_hitl_routes(self, tmp_path):
        from app.main import app

        client = TestClient(app)

        # 1. List brands & topup vault
        client.post(
            "/api/v1/treasury/brands",
            json={
                "brand_id": "brd_s6_01",
                "slug": "tienda-s6-ve",
                "display_name": "Tienda S6 Cashea VE",
                "industry_vertical": "CASHEA_ALLY",
                "spend_cap_usd": 800.0,
                "initial_vault_usd": 600.0,
            },
        )
        topup = client.post(
            "/api/v1/treasury/topup",
            json={"brand_id": "brd_s6_01", "amount_usd": 200.0, "note": "Recarga USDT S6"},
        )
        assert topup.status_code == 200
        assert topup.json()["balance_after_usd"] == 800.0

        brands_res = client.get("/api/v1/treasury/brands")
        assert brands_res.status_code == 200
        ids = [b["brand_id"] for b in brands_res.json()["brands"]]
        assert "brd_s6_01" in ids

        # 2. Live Creative Brief + Compliance Audit
        brief_res = client.post(
            "/api/v1/agents/briefs/generate",
            json={
                "brand_id": "brd_s6_01",
                "product_or_offer": "Combo Cocina Pro con Cashea 40% inicial",
                "target_audience_ve": "Caracas y Maracay",
            },
        )
        assert brief_res.status_code == 200
        b_body = brief_res.json()
        assert len(b_body["hooks"]) == 3
        assert b_body["compliance"]["status"] in ("APPROVED", "REWRITTEN_APPROVED")

        # 3. Live YouTube Surgical Clip Preparation (--download-sections)
        yt_res = client.post(
            "/api/v1/viral-clips/prepare-youtube",
            json={
                "brand_id": "brd_s6_01",
                "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "start_timestamp": "00:05:10",
                "end_timestamp": "00:06:00",
            },
        )
        assert yt_res.status_code == 200
        assert "--download-sections" in " ".join(yt_res.json()["yt_dlp_command"])

        # 4. Live 2-Layer Nano Banana Flyer Generation
        flyer_res = client.post(
            "/api/v1/flyers/generate",
            json={
                "brand_id": "brd_s6_01",
                "brand_slug": "tienda-s6-ve",
                "headline": "COMBO COCINA CASHEA",
                "price_badge": "INICIAL $35 + 3 CUOTAS",
                "cta_text": "ESCRIBINOS POR WHATSAPP",
                "nano_banana_prompt": "Studio kitchen appliance OLED background",
                "aspect_ratio": "9:16",
            },
        )
        assert flyer_res.status_code == 200
        f_body = flyer_res.json()
        assert f_body["dimensions"] == [1080, 1920]
        assert Path(f_body["local_png_path"]).exists()

        # 5. Live HITL Proposal Staging + Dashboard Approval
        stage_res = client.post(
            "/api/v1/hitl/proposals",
            json={
                "brand_id": "brd_s6_01",
                "ad_account_brand_id": "brd_s6_01",
                "pixel_brand_id": "brd_s6_01",
                "platform": "META_ADS",
                "campaign_name": "cmp_s6_live",
                "daily_budget_usd": 75.0,
                "copy_text": "Equipa tu hogar hoy con cuotas sin interés.",
            },
        )
        assert stage_res.status_code == 200
        approval_id = stage_res.json()["approval_id"]

        approve_res = client.post(f"/api/v1/hitl/{approval_id}/approve")
        assert approve_res.status_code == 200
        assert approve_res.json()["status"] == "ACTIVE"
        assert approve_res.json()["committed_spend_usd"] == 75.0

        # 6. Sandbox Inbox Listing (Read-Only E:\Agencia_Inbox\)
        inbox_res = client.get("/api/v1/sandbox/list-inbox")
        assert inbox_res.status_code == 200
        assert "authorized_inbox_dir" in inbox_res.json()
        assert isinstance(inbox_res.json()["files"], list)
