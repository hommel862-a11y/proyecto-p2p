import base64
import json
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any, Optional
import httpx

# Current 2026 official Gemini API models (legacy gemini-1.5-* / 2.0-* / 2.5-* are deprecated)
GENAI_2026_MODELS: dict[str, str] = {
    "multimodal_brain": "gemini-3.8-flash",
    "multimodal_fast_fallback": "gemini-3.5-flash-lite",
    "image_nano_banana": "gemini-nano-banana-2.1",
    "image_nano_banana_pro": "gemini-3-pro-image",
    "video_omni": "gemini-omni-1.2-flash",
    "transcribe": "gemini-3.5-transcribe",
    "tts_voice_replication": "gemini-3.8-flash-tts",
    "tts_fast": "gemini-3.8-flash-lite-tts",
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


def synthesize_gemini_tts_wav(api_key: str, text: str) -> Optional[bytes]:
    """
    Synthesizes real neural WAV voiceover via Gemini 3.8 TTS Interactions API.
    Returns RIFF WAV bytes or None if quota/network fails.
    """
    headers = {
        "x-goog-api-key": api_key,
        "Api-Revision": "2026-05-20",
        "Content-Type": "application/json",
    }
    for model_id in ("gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"):
        try:
            res = httpx.post(
                "https://generativelanguage.googleapis.com/v1beta/interactions",
                headers=headers,
                json={"model": model_id, "input": text.strip()},
                timeout=20.0,
            )
            if res.status_code != 200:
                continue
            data = res.json()
            for step in reversed(data.get("steps", [])):
                for part in step.get("content", []):
                    if part.get("type") == "audio" and part.get("data"):
                        return base64.b64decode(part["data"])
        except Exception:
            continue
    return None


def generate_gemini_brief_json(
    api_key: str,
    brand_name: str,
    offer: str,
    audience: str,
) -> Optional[dict[str, Any]]:
    """
    Calls Gemini 3.8 Flash (with fast failover to Gemini 3.5 Flash-Lite) via Interactions API
    to generate 3 direct-response 9:16 video hooks and Click-to-WhatsApp sales copy.
    """
    headers = {
        "x-goog-api-key": api_key,
        "Api-Revision": "2026-05-20",
        "Content-Type": "application/json",
    }
    prompt = (
        f"Act as a direct-response performance creative director for '{brand_name}'. "
        f"Offer: '{offer}'. Target audience: '{audience}'. "
        "Return ONLY valid JSON (no markdown fences) with keys: "
        "'hook_a', 'hook_b', 'hook_c' (each a punchy 1-sentence Spanish 3-second spoken hook), "
        "and 'direct_response_copy' (2-sentence Spanish Click-to-WhatsApp ad copy without prohibited financial guarantees)."
    )
    for model_id in ("gemini-3.5-flash-lite", "gemini-3.8-flash"):
        try:
            res = httpx.post(
                "https://generativelanguage.googleapis.com/v1beta/interactions",
                headers=headers,
                json={"model": model_id, "input": prompt},
                timeout=14.0,
            )
            if res.status_code != 200:
                continue
            body = res.json()
            raw_text = ""
            for step in reversed(body.get("steps", [])):
                if step.get("type") == "model_output":
                    for part in step.get("content", []):
                        if part.get("type") == "text" and part.get("text"):
                            raw_text += part["text"]
                    if raw_text:
                        break
            cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(cleaned)
            if all(k in parsed for k in ("hook_a", "hook_b", "hook_c", "direct_response_copy")):
                parsed["model_used"] = model_id
                return parsed
        except Exception:
            continue
    return None


def render_ffmpeg_916_reel(
    image_path: Path,
    output_mp4_path: Path,
    wav_path: Optional[Path] = None,
    duration_sec: float = 7.0,
) -> dict[str, Any]:
    """
    Renders a real playable 1080x1920 H.264 + AAC MP4 vertical Reel from a base image/flyer
    and optional WAV voiceover using local FFmpeg.
    """
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("FFmpeg binary not found in PATH")

    output_mp4_path.parent.mkdir(parents=True, exist_ok=True)
    fps = 25
    total_frames = max(25, int(round(duration_sec * fps)))
    vf_chain = (
        f"scale=1200:2134:force_original_aspect_ratio=increase,"
        f"crop=1200:2134,"
        f"zoompan=z='min(zoom+0.0012,1.10)':d={total_frames}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps={fps},"
        f"format=yuv420p"
    )

    cmd = [ffmpeg_bin, "-y", "-loop", "1", "-i", str(image_path)]
    if wav_path and wav_path.exists():
        cmd += ["-i", str(wav_path)]
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000"]

    cmd += [
        "-vf",
        vf_chain,
        "-t",
        f"{duration_sec:.2f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(output_mp4_path),
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if proc.returncode != 0 or not output_mp4_path.exists():
        raise RuntimeError(f"FFmpeg reel render failed: {proc.stderr[-300:]}")

    return {
        "local_mp4_path": str(output_mp4_path),
        "size_bytes": output_mp4_path.stat().st_size,
        "duration_sec": duration_sec,
        "resolution": "1080x1920",
    }
