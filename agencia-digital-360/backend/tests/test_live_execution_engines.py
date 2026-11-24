from pathlib import Path
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient


class TestLiveExecutionEngines:
    def test_live_video_flow_import_and_omni_12_execution_endpoint(self, tmp_path):
        import app.main as main_mod

        # Create a real .mp4 inside the Google Flow watch-folder
        flow_dir = main_mod.settings_instance.local_inbox_dir / "flow_exports"
        flow_dir.mkdir(parents=True, exist_ok=True)
        sample_flow = flow_dir / "test_flow_import_916.mp4"
        sample_flow.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")

        client = TestClient(main_mod.app)
        res = client.post(
            "/api/v1/video/import-flow-export",
            json={
                "brand_id": "brd_live_01",
                "brand_slug": "marca-live",
                "filename": "test_flow_import_916.mp4",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["category"] == "videos"
        assert body["relative_url"].startswith("/api/v1/media/files/marca-live/videos/")
        assert Path(body["local_path"]).exists()

        # Verify file is playable over HTTP
        stream_res = client.get(body["relative_url"])
        assert stream_res.status_code == 200
        assert b"ftypmp42" in stream_res.content

        # Clean up test sample from flow_exports
        sample_flow.unlink(missing_ok=True)

    def test_live_flyer_generation_saves_servable_png_in_brand_vault(self):
        import app.main as main_mod

        client = TestClient(main_mod.app)
        res = client.post(
            "/api/v1/flyers/generate-live",
            json={
                "brand_id": "brd_live_01",
                "brand_slug": "marca-live",
                "headline": "OFERTA ESPECIAL CARACAS",
                "price_badge": "$39 USD · ENVIO GRATIS",
                "cta_text": "ESCRIBENOS POR WHATSAPP",
                "nano_banana_prompt": "Commercial product shot on dark obsidian glass",
                "aspect_ratio": "9:16",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["relative_url"].startswith("/api/v1/media/files/marca-live/flyers/")
        assert body["dimensions"] == [1080, 1920]

        img_res = client.get(body["relative_url"])
        assert img_res.status_code == 200
        assert img_res.content.startswith(b"\x89PNG")

    def test_live_ctwa_deploy_and_telegram_alert_dispatcher_with_mocked_http(self):
        from app.integrations.meta_ctwa_billing import execute_ctwa_live_deploy, send_telegram_hitl_alert
        import asyncio

        class FakeResp:
            def __init__(self, status_code: int, payload: dict):
                self.status_code = status_code
                self._payload = payload
                self.text = str(payload)

            def json(self):
                return self._payload

        responses = [
            FakeResp(200, {"id": "vid_991"}),
            FakeResp(200, {"id": "cmp_992"}),
            FakeResp(200, {"id": "adset_993"}),
            FakeResp(200, {"id": "cre_994"}),
            FakeResp(200, {"id": "ad_995"}),
        ]

        async def run_checks():
            with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=responses)):
                deploy = await execute_ctwa_live_deploy(
                    access_token="EAA_LIVE_TOKEN",
                    brand_id="brd_live_01",
                    ad_account_id="act_555111",
                    page_id="pg_111",
                    whatsapp_phone="+584121234567",
                    campaign_name="Live CTWA Test",
                    daily_budget_usd=20.0,
                    video_public_url="https://cdn.example.com/v.mp4",
                    copy_text="Escribinos ahora",
                    tracking_code="AD-LIVE-01",
                )
            assert deploy["ok"] is True
            assert deploy["meta_ids"] == {
                "video_id": "vid_991",
                "campaign_id": "cmp_992",
                "adset_id": "adset_993",
                "creative_id": "cre_994",
                "ad_id": "ad_995",
            }

            with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=FakeResp(200, {"ok": True, "result": {"message_id": 77}}))):
                tg = await send_telegram_hitl_alert(
                    bot_token="123:ABC",
                    chat_id="998877",
                    text="Alerta 80% tarjeta Wally *4821",
                )
            assert tg["ok"] is True
            assert tg["message_id"] == 77

        asyncio.run(run_checks())

    def test_step_by_step_readiness_endpoint_reports_honest_live_progress(self):
        import app.main as main_mod

        client = TestClient(main_mod.app)
        res = client.get("/api/v1/setup/roadmap-status")
        assert res.status_code == 200
        body = res.json()
        assert len(body["steps"]) == 6
        assert body["steps"][0]["id"] == "step_1_backend_online"
        assert body["steps"][0]["completed"] is True
