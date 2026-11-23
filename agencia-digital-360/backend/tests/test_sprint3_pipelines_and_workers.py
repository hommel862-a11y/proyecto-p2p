from pathlib import Path
import pytest
from fastapi.testclient import TestClient


class TestSprint3VideoPipelineMoneyPrinterTurbo:
    def test_video_pipeline_enforces_custom_audio_patch_and_ab_hooks(self, tmp_path):
        from app.services.video_pipeline import VideoPipelineService

        audio_file = tmp_path / "voz_locutor_ve.wav"
        audio_file.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")

        service = VideoPipelineService(
            mpt_api_url="http://localhost:8085",
            public_bucket_base_url="https://cdn.agencia360.ve/public",
        )
        jobs = service.build_ab_hook_render_jobs(
            brand_id="brd_cashea_01",
            brand_slug="tienda-cashea-ve",
            brief_id="brf_042",
            custom_audio_path=str(audio_file),
            hooks=[
                {"variant": "HOOK_A", "script_3s": "¿Tu comercio pierde margen con la brecha?", "broll_scene": "flow_scene_a.mp4"},
                {"variant": "HOOK_B", "script_3s": "Cómo 120 tiendas en Caracas venden más con Cashea", "broll_scene": "higgsfield_scene_b.mp4"},
            ],
            body_scenes=["broll_demo_1.mp4", "broll_cta_whatsapp.mp4"],
            hitl_approved=True,
        )

        assert len(jobs) == 2
        job_a = jobs[0]
        assert job_a["hook_variant"] == "HOOK_A"
        assert job_a["mpt_payload"]["custom_audio_path"] == str(audio_file)
        assert job_a["mpt_payload"]["skip_tts"] is True
        assert job_a["mpt_payload"]["aspect_ratio"] == "9:16"
        assert job_a["mpt_payload"]["whisper_word_timestamps"] is True
        assert "SINCRONIZADO CON WHISPER" in job_a["whisper_srt_preview"]
        assert job_a["public_https_url"].startswith(
            "https://cdn.agencia360.ve/public/brands/tienda-cashea-ve/videos/"
        )


class TestSprint3SurgicalViralClips:
    def test_viral_clips_dual_input_local_inbox_and_youtube_download_sections(self, tmp_path):
        from app.services.viral_clips import ViralClipsService
        from app.core.security import SecurityViolationError

        inbox = tmp_path / "Agencia_Inbox"
        inbox.mkdir()
        local_video = inbox / "podcast_caracas.mp4"
        local_video.write_bytes(b"\x00\x00\x00\x18ftypmp42")

        clipper = ViralClipsService(allowed_inbox_root=inbox)

        # 1. Mode A: Authorized local file in E:\Agencia_Inbox\ succeeds
        local_job = clipper.prepare_local_inbox_clip(
            brand_id="brd_01",
            file_path=str(local_video),
            start_sec=12.0,
            end_sec=48.0,
        )
        assert local_job["source_mode"] == "PC_LOCAL_INBOX"
        assert local_job["output_aspect_ratio"] == "9:16"
        assert local_job["duration_sec"] == 36.0

        # 2. Mode A: File outside E:\Agencia_Inbox\ is blocked
        outside = tmp_path / "forbidden.mp4"
        outside.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        with pytest.raises(SecurityViolationError, match="outside authorized inbox"):
            clipper.prepare_local_inbox_clip(
                brand_id="brd_01",
                file_path=str(outside),
                start_sec=0.0,
                end_sec=30.0,
            )

        # 3. Mode B: Surgical YouTube extraction uses yt-dlp --download-sections
        yt_job = clipper.prepare_youtube_surgical_clip(
            brand_id="brd_01",
            youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            start_timestamp="00:18:10",
            end_timestamp="00:19:05",
        )
        assert yt_job["source_mode"] == "YOUTUBE_SURGICAL"
        cmd_str = " ".join(yt_job["yt_dlp_command"])
        assert "--download-sections" in cmd_str
        assert "*00:18:10-00:19:05" in cmd_str
        assert "--force-keyframes-at-cuts" in cmd_str

    def test_mediapipe_kalman_916_crop_smoothing(self):
        from app.services.viral_clips import Kalman1DCropFilter

        tracker = Kalman1DCropFilter(source_width=1920, source_height=1080)
        # Simulate noisy face detections around x=1200 in a 1920x1080 frame
        raw_positions = [1200, 1218, 1185, 1210, 1195]
        crops = [tracker.compute_916_crop_box(x) for x in raw_positions]

        for crop in crops:
            assert crop["crop_w"] == 608
            assert crop["crop_h"] == 1080
            assert 0 <= crop["crop_x"] <= (1920 - 608)

        # Smoothed trajectory must have lower variance than noisy input
        raw_jumps = sum(abs(raw_positions[i] - raw_positions[i - 1]) for i in range(1, len(raw_positions)))
        smooth_centers = [c["crop_x"] + c["crop_w"] // 2 for c in crops]
        smooth_jumps = sum(abs(smooth_centers[i] - smooth_centers[i - 1]) for i in range(1, len(smooth_centers)))
        assert smooth_jumps < raw_jumps


class TestSprint3NanoBananaFlyerPipelineAndCeleryWorker:
    def test_flyer_pipeline_generates_916_and_45_branded_flyers(self, tmp_path):
        from app.services.flyer_pipeline import FlyerPipelineService

        service = FlyerPipelineService(
            output_dir=tmp_path,
            public_bucket_base_url="https://cdn.agencia360.ve/public",
        )
        result = service.generate_commercial_flyer(
            brand_id="brd_cashea_01",
            brand_slug="tienda-cashea-ve",
            headline="EQUIPA TU NEGOCIO HOY",
            price_badge="INICIAL $48 USD + 3 CUOTAS CASHEA",
            cta_text="ESCRIBINOS POR WHATSAPP · TASA BCV",
            nano_banana_prompt="Clean studio shot of commercial espresso machine, dark OLED background",
            aspect_ratio="9:16",
        )
        assert result["engine"] == "nano_banana_v1_plus_deterministic_overlay"
        assert result["aspect_ratio"] == "9:16"
        assert result["dimensions"] == (1080, 1920)
        assert result["text_area_ratio_pct"] < 18.0
        assert Path(result["local_png_path"]).exists()
        assert result["public_https_url"].startswith(
            "https://cdn.agencia360.ve/public/brands/tienda-cashea-ve/flyers/"
        )

    def test_celery_worker_enforces_concurrency_one_lock(self):
        from app.workers.celery_app import CELERY_CONFIG
        from app.workers.tasks import SingleConcurrencyVideoLock, VideoWorkerBusyError

        assert CELERY_CONFIG["worker_concurrency"] == 1
        assert CELERY_CONFIG["worker_prefetch_multiplier"] == 1
        assert "video_heavy" in CELERY_CONFIG["task_queues"]

        lock = SingleConcurrencyVideoLock()
        with lock.acquire("job_video_01"):
            with pytest.raises(VideoWorkerBusyError, match="Concurrency=1 lock active"):
                with lock.acquire("job_video_02"):
                    pass
