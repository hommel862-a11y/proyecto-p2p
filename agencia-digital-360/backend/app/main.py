import json
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from app.core.config import get_settings, now_vet
from app.core.security import (
    BrandCredentialVault,
    validate_local_inbox_path,
    SecurityViolationError,
)
from app.services.treasury import TreasuryService, TreasuryError
from app.agents.creative_director import CreativeDirectorAgent
from app.agents.compliance_auditor import ComplianceAuditorAgent, ComplianceError
from app.agents.vault_controller import VaultControllerAgent
from app.agents.trafficker import TraffickerAgent, TraffickerGateError
from app.integrations.telegram_bot import TelegramHitlBotService
from app.integrations.meta_ads import MetaAdsIntegration
from app.integrations.arm_bridge import ArmBridgeService, ArmWebhookAuthError

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

settings_instance = get_settings()
credential_vault = BrandCredentialVault(master_secret=settings_instance.master_vault_secret)
treasury_service = TreasuryService()
creative_director_agent = CreativeDirectorAgent()
compliance_auditor_agent = ComplianceAuditorAgent()
vault_controller_agent = VaultControllerAgent(treasury_service)
trafficker_agent = TraffickerAgent(
    treasury=treasury_service,
    auditor=compliance_auditor_agent,
    vault_controller=vault_controller_agent,
)
telegram_hitl_service = TelegramHitlBotService(
    treasury=treasury_service,
    creative_director=creative_director_agent,
    trafficker=trafficker_agent,
)
meta_ads_integration = MetaAdsIntegration(credential_vault=credential_vault)
arm_bridge_service = ArmBridgeService(
    treasury=treasury_service,
    meta_ads=meta_ads_integration,
    hmac_secret=settings_instance.arm_webhook_hmac_secret,
)


class BrandVaultRegisterPayload(BaseModel):
    brand_id: str
    slug: str
    display_name: str
    industry_vertical: str
    spend_cap_usd: float = Field(..., gt=0)
    initial_vault_usd: float = Field(default=0.0, ge=0)
    alert_threshold_pct: float = Field(default=20.0, ge=5.0, le=50.0)


class TelegramWebhookPayload(BaseModel):
    chat_id: str
    update_type: str  # VOICE_NOTE | CALLBACK_QUERY
    brand_id: Optional[str] = None
    voice_duration_sec: Optional[int] = None
    voice_transcript: Optional[str] = None
    requested_budget_usd: Optional[float] = None
    callback_data: Optional[str] = None


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


@app.post("/api/v1/treasury/brands")
def register_brand_vault(payload: BrandVaultRegisterPayload) -> dict:
    state = treasury_service.register_brand(
        brand_id=payload.brand_id,
        slug=payload.slug,
        display_name=payload.display_name,
        industry_vertical=payload.industry_vertical,
        spend_cap_usd=payload.spend_cap_usd,
        initial_vault_usd=payload.initial_vault_usd,
        alert_threshold_pct=payload.alert_threshold_pct,
    )
    return {
        "brand_id": state.brand_id,
        "slug": state.slug,
        "spend_cap_usd": state.spend_cap_usd,
        "vault_balance_usd": state.vault_balance_usd,
        "alert_threshold_pct": state.alert_threshold_pct,
    }


@app.post("/api/v1/telegram/webhook")
def handle_telegram_webhook(payload: TelegramWebhookPayload) -> dict:
    try:
        if payload.update_type == "VOICE_NOTE":
            if not payload.brand_id or not payload.voice_transcript or not payload.requested_budget_usd:
                raise HTTPException(status_code=400, detail="Missing brand_id, voice_transcript, or requested_budget_usd")
            return telegram_hitl_service.handle_voice_note_brief(
                chat_id=payload.chat_id,
                brand_id=payload.brand_id,
                voice_transcript=payload.voice_transcript,
                requested_budget_usd=payload.requested_budget_usd,
            )
        if payload.update_type == "CALLBACK_QUERY":
            if not payload.callback_data:
                raise HTTPException(status_code=400, detail="Missing callback_data")
            return telegram_hitl_service.handle_callback_query(
                chat_id=payload.chat_id,
                callback_data=payload.callback_data,
            )
        raise HTTPException(status_code=400, detail=f"Unsupported update_type: {payload.update_type}")
    except (TreasuryError, ComplianceError, TraffickerGateError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/webhooks/arm-conversion")
async def handle_arm_conversion_webhook(request: Request) -> dict:
    raw_body = await request.body()
    sig = request.headers.get("X-Agencia360-Signature", "")
    ts_str = request.headers.get("X-Agencia360-Timestamp", "0")
    idem_key = request.headers.get("X-Idempotency-Key", "")
    test_now_str = request.headers.get("X-Test-Now-Epoch")

    try:
        ts_val = int(ts_str)
        now_val = int(test_now_str) if test_now_str is not None else None
        return arm_bridge_service.process_inbound_closed_won(
            raw_body=raw_body,
            signature_header=sig,
            timestamp_header=ts_val,
            idempotency_key=idem_key,
            now_epoch=now_val,
        )
    except ArmWebhookAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except (TreasuryError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
