import json
from pathlib import Path
from fastapi import FastAPI, HTTPException
from app.core.config import get_settings, now_vet
from app.core.security import validate_local_inbox_path, SecurityViolationError

app = FastAPI(
    title="Agencia Digital 360 — Execution Module API",
    version="1.0.0",
    description=(
        "Decoupled digital marketing, MoneyPrinterTurbo 9:16 video pipeline, "
        "surgical viral clip extractor, Nano Banana flyer studio, and multi-platform "
        "ad trafficker for Venezuela & LATAM."
    ),
)

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "arm_webhook_contract.json"


@app.get("/api/v1/health")
def get_health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "timezone": f"{settings.timezone_name} (VET UTC-04:00)",
        "timestamp_vet": now_vet().isoformat(),
        "video_worker_concurrency": settings.video_worker_concurrency,
        "arm_decoupled": settings.arm_decoupled,
        "ai_stack_ve": list(settings.ai_stack_ve),
        "local_inbox_dir": str(settings.local_inbox_dir),
        "moneyprinter_custom_audio_patch": settings.moneyprinter_custom_audio_patch,
    }


@app.get("/api/v1/contracts/arm-webhook")
def get_arm_webhook_contract() -> dict:
    if not CONTRACT_PATH.exists():
        raise HTTPException(status_code=404, detail="ARM webhook contract file not found")
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


@app.get("/api/v1/sandbox/verify-file")
def verify_inbox_file(filename: str) -> dict:
    settings = get_settings()
    candidate = settings.local_inbox_dir / filename
    try:
        resolved = validate_local_inbox_path(
            str(candidate),
            allowed_root=settings.local_inbox_dir,
        )
    except SecurityViolationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return {
        "allowed": True,
        "resolved_path": str(resolved),
        "mode": "READ_ONLY",
    }
