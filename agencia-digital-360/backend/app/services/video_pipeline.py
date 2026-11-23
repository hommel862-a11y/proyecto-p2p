from pathlib import Path
import uuid
from app.services.treasury import HitlApprovalRequiredError


class VideoPipelineService:
    """
    Orquestador Google Flow / Higgsfield -> MoneyPrinterTurbo V1.
    Includes the critical `custom_audio_path` patch:
    - Bypasses synthetic TTS when human voice recording is provided
    - Aligns word-level subtitles via faster-whisper
    - Generates A/B/C Hook variants swapping only the 0-3s lead scene
    - Publishes assets to the brand's isolated public HTTPS storage prefix
    """

    def __init__(
        self,
        mpt_api_url: str = "http://localhost:8085",
        public_bucket_base_url: str = "https://project-ref.supabase.co/storage/v1/object/public/agencia360-media",
    ) -> None:
        self._mpt_api_url = mpt_api_url.rstrip("/")
        self._bucket_base = public_bucket_base_url.rstrip("/")

    def build_ab_hook_render_jobs(
        self,
        brand_id: str,
        brand_slug: str,
        brief_id: str,
        custom_audio_path: str,
        hooks: list[dict],
        body_scenes: list[str],
        hitl_approved: bool = False,
    ) -> list[dict]:
        if not hitl_approved:
            raise HitlApprovalRequiredError(
                "Human-in-the-Loop approval is required before queuing bulk video renders"
            )
        audio_path = Path(custom_audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Custom voice audio file not found: {custom_audio_path}")

        jobs: list[dict] = []
        for hook in hooks:
            variant = hook["variant"]
            asset_id = f"vid_{brief_id}_{variant.lower()}_{uuid.uuid4().hex[:6]}"
            srt_preview = (
                "1\n00:00:00,120 --> 00:00:03,100\n"
                f"[SINCRONIZADO CON WHISPER · {variant}] {hook['script_3s']}\n"
            )
            mpt_payload = {
                "task_id": asset_id,
                "aspect_ratio": "9:16",
                "resolution": "1080x1920",
                "custom_audio_path": str(audio_path),
                "skip_tts": True,
                "whisper_model": "large-v3-turbo",
                "whisper_word_timestamps": True,
                "subtitle_style": "HIGH_CONTRAST_KARAOKE_916",
                "video_materials": [hook["broll_scene"]] + list(body_scenes),
                "bgm_ducking_db": -18.0,
            }
            public_url = f"{self._bucket_base}/brands/{brand_slug}/videos/{asset_id}.mp4"
            jobs.append(
                {
                    "asset_id": asset_id,
                    "brand_id": brand_id,
                    "brief_id": brief_id,
                    "hook_variant": variant,
                    "mpt_endpoint": f"{self._mpt_api_url}/api/v1/videos",
                    "mpt_payload": mpt_payload,
                    "whisper_srt_preview": srt_preview,
                    "public_https_url": public_url,
                    "worker_queue": "video_heavy",
                    "concurrency_slot": 1,
                }
            )
        return jobs
