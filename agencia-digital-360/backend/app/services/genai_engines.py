import shutil
import time
from typing import Any, Optional
import httpx

# Current 2026 official Gemini API models (legacy gemini-1.5-* / 2.0-* / 2.5-* are deprecated)
GENAI_2026_MODELS: dict[str, str] = {
    "multimodal_brain": "gemini-3.8-flash",
    "image_nano_banana": "gemini-nano-banana-2.1",
    "image_nano_banana_pro": "gemini-3-pro-image",
    "video_omni": "gemini-omni-1.2-flash",
    "transcribe": "gemini-3.5-transcribe",
    "tts_voice_replication": "gemini-3.8-flash-tts",
}


def inspect_local_runtime_capabilities() -> dict[str, Any]:
    """Honest runtime telemetry of local binaries without inventing availability."""
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    return {
        "ffmpeg_installed": bool(ffmpeg_path),
        "ffmpeg_path": ffmpeg_path,
        "ffprobe_installed": bool(ffprobe_path),
        "genai_models_2026": dict(GENAI_2026_MODELS),
    }


async def probe_provider_connection(
    provider: str,
    secret_token: str,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Executes a REAL live HTTP connectivity check for the configured API provider.
    Never fakes a green check when credentials are invalid or unreachable.
    """
    meta = metadata or {}
    t0 = time.perf_counter()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "GEMINI_API":
                res = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": secret_token, "pageSize": 5},
                )
            elif provider == "OPENAI_API":
                res = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {secret_token}"},
                )
            elif provider == "META_ADS":
                res = await client.get(
                    "https://graph.facebook.com/v21.0/me",
                    params={"fields": "id,name", "access_token": secret_token},
                )
            elif provider == "TELEGRAM_BOT":
                res = await client.get(f"https://api.telegram.org/bot{secret_token}/getMe")
            elif provider == "ARM_WEBHOOK":
                url = str(meta.get("arm_health_url", "http://127.0.0.1:3030/api/arm/health/storage"))
                res = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {secret_token}"} if secret_token else {},
                )
            else:
                return {
                    "ok": False,
                    "provider": provider,
                    "status_code": 400,
                    "latency_ms": 0,
                    "detail": f"Unsupported provider probe: {provider}",
                }

        latency_ms = int((time.perf_counter() - t0) * 1000)
        ok = 200 <= res.status_code < 300
        return {
            "ok": ok,
            "provider": provider,
            "status_code": res.status_code,
            "latency_ms": latency_ms,
            "detail": "CONNECTED" if ok else f"HTTP {res.status_code}: {res.text[:180]}",
        }
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": False,
            "provider": provider,
            "status_code": 0,
            "latency_ms": latency_ms,
            "detail": f"Network error: {exc}",
        }
