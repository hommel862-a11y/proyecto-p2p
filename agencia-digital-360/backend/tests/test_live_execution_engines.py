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

    def test_flyer_composites_base_photo_and_ffmpeg_renders_playable_916_reel(self, tmp_path, monkeypatch):
        import shutil
        from PIL import Image
        import app.main as main_mod
        from app.core.database import AgenciaSqliteStore
        from app.services.media_vault import MediaVaultService

        isolated_store = AgenciaSqliteStore(
            db_path=tmp_path / "isolated.db",
            credential_vault=main_mod.credential_vault,
        )
        isolated_vault = MediaVaultService(
            storage_root=tmp_path / "storage",
            inbox_root=tmp_path / "inbox",
        )
        monkeypatch.setattr(main_mod, "sqlite_store", isolated_store)
        monkeypatch.setattr(main_mod, "media_vault_service", isolated_vault)

        # 1. Create a bright crimson test product photo and upload it
        photo_buf_path = tmp_path / "producto.png"
        Image.new("RGB", (600, 1000), color=(210, 45, 35)).save(photo_buf_path, format="PNG")

        client = TestClient(main_mod.app)
        with photo_buf_path.open("rb") as fh:
            up_res = client.post(
                "/api/v1/media/upload",
                data={"brand_id": "brd_iso", "brand_slug": "iso-brand", "category": "photos"},
                files={"file": ("producto.png", fh, "image/png")},
            )
        assert up_res.status_code == 200

        # 2. Generate live flyer -> center pixel should reflect composited crimson photo, not plain (9, 13, 22)
        fly_res = client.post(
            "/api/v1/flyers/generate-live",
            json={
                "brand_id": "brd_iso",
                "brand_slug": "iso-brand",
                "headline": "PASTELITOS ANDINOS",
                "price_badge": "COMBO $10 USD",
                "cta_text": "PIDE POR WHATSAPP",
                "nano_banana_prompt": "Pastelitos andinos",
                "aspect_ratio": "9:16",
            },
        )
        assert fly_res.status_code == 200
        flyer_asset = isolated_store.list_media_assets("brd_iso")[0]
        with Image.open(flyer_asset["local_path"]) as out_img:
            center_r, _, _ = out_img.getpixel((540, 960))
            assert center_r > 120

        # 3. Render real 9:16 H.264 MP4 reel via /api/v1/video/render-local-reel when ffmpeg is installed
        if shutil.which("ffmpeg"):
            reel_res = client.post(
                "/api/v1/video/render-local-reel",
                json={
                    "brand_id": "brd_iso",
                    "brand_slug": "iso-brand",
                    "voice_script": "Pide hoy en Gochos Venezuela.",
                    "duration_sec": 3.0,
                },
            )
            assert reel_res.status_code == 200
            rbody = reel_res.json()
            assert rbody["category"] == "videos"
            assert rbody["relative_url"].endswith(".mp4")
            stream = client.get(rbody["relative_url"])
            assert stream.status_code == 200
            assert b"ftyp" in stream.content[:64]
