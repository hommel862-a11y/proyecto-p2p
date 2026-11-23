from dataclasses import asdict
import json
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from app.core.config import get_settings, now_vet
from app.core.security import (
    ALLOWED_VIDEO_EXTENSIONS,
    BrandCredentialVault,
    validate_local_inbox_path,
    SecurityViolationError,
)
from app.services.treasury import TreasuryService, TreasuryError
from app.services.video_pipeline import VideoPipelineService
from app.services.viral_clips import ViralClipsService
from app.services.flyer_pipeline import FlyerPipelineService
from app.agents.creative_director import CreativeDirectorAgent
from app.agents.compliance_auditor import ComplianceAuditorAgent, ComplianceError
from app.agents.vault_controller import VaultControllerAgent
from app.agents.trafficker import TraffickerAgent, TraffickerGateError
from app.integrations.telegram_bot import TelegramHitlBotService
from app.integrations.meta_ads import MetaAdsIntegration
from app.integrations.arm_bridge import ArmBridgeService, ArmWebhookAuthError
from app.workers.tasks import SingleConcurrencyVideoLock, VideoWorkerBusyError

app = FastAPI(
    title="Agencia Digital 360 — Execution Module API",
    version="1.0.0",
    description=(
        "Decoupled digital marketing, MoneyPrinterTurbo 9:16 video pipeline, "
        "surgical viral clip extractor, Nano Banana flyer studio, and multi-platform "
        "ad trafficker for Venezuela & LATAM."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:3030",
        "http://127.0.0.1:3030",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
video_pipeline_service = VideoPipelineService(
    mpt_api_url=settings_instance.moneyprinter_api_url,
)
viral_clips_service = ViralClipsService(
    allowed_inbox_root=settings_instance.local_inbox_dir,
)
flyer_pipeline_service = FlyerPipelineService(
    output_dir=settings_instance.storage_dir / "flyers",
)
video_concurrency_lock = SingleConcurrencyVideoLock()


class BrandVaultRegisterPayload(BaseModel):
    brand_id: str
    slug: str
    display_name: str
    industry_vertical: str
    spend_cap_usd: float = Field(..., gt=0)
    initial_vault_usd: float = Field(default=0.0, ge=0)
    alert_threshold_pct: float = Field(default=20.0, ge=5.0, le=50.0)


class VaultTopupPayload(BaseModel):
    brand_id: str
    amount_usd: float = Field(..., gt=0)
    note: str = "USDT Vault Top-up"


class BriefGeneratePayload(BaseModel):
    brand_id: str
    product_or_offer: str
    target_audience_ve: str = "Venezuela & LATAM"
    custom_audio_path: Optional[str] = None


class ViralLocalClipPayload(BaseModel):
    brand_id: str
    filename: str
    start_sec: float = Field(..., ge=0)
    end_sec: float = Field(..., gt=0)


class ViralYoutubeClipPayload(BaseModel):
    brand_id: str
    youtube_url: str
    start_timestamp: str
    end_timestamp: str


class FlyerGeneratePayload(BaseModel):
    brand_id: str
    brand_slug: str
    headline: str
    price_badge: str
    cta_text: str
    nano_banana_prompt: str
    aspect_ratio: str = "9:16"


class HitlStageCampaignPayload(BaseModel):
    brand_id: str
    ad_account_brand_id: str
    pixel_brand_id: str
    platform: str
    campaign_name: str
    daily_budget_usd: float = Field(..., gt=0)
    copy_text: str


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


@app.get("/api/v1/sandbox/list-inbox")
def list_authorized_inbox_files() -> dict:
    settings = get_settings()
    inbox_root = settings.local_inbox_dir
    files: list[dict] = []
    if inbox_root.exists() and inbox_root.is_dir():
        for entry in sorted(inbox_root.iterdir()):
            if entry.is_file() and not entry.is_symlink() and entry.suffix.lower() in ALLOWED_VIDEO_EXTENSIONS:
                files.append(
                    {
                        "filename": entry.name,
                        "size_mb": round(entry.stat().st_size / (1024 * 1024), 2),
                        "extension": entry.suffix.lower(),
                    }
                )
    return {
        "authorized_inbox_dir": str(inbox_root),
        "mode": "READ_ONLY",
        "files": files,
    }


@app.get("/api/v1/treasury/brands")
def list_brand_vaults() -> dict:
    items = []
    for state in treasury_service._brands.values():
        used = state.accumulated_spend_usd + state.reserved_spend_usd
        rem_ratio = round((max(0.0, state.spend_cap_usd - used) / state.spend_cap_usd) * 100.0, 2)
        roas = (
            round(state.attributed_revenue_usd / state.accumulated_spend_usd, 2)
            if state.accumulated_spend_usd > 0
            else 0.0
        )
        items.append(
            {
                "brand_id": state.brand_id,
                "slug": state.slug,
                "display_name": state.display_name,
                "industry_vertical": state.industry_vertical,
                "vault_balance_usd": state.vault_balance_usd,
                "spend_cap_usd": state.spend_cap_usd,
                "accumulated_spend_usd": state.accumulated_spend_usd,
                "reserved_spend_usd": state.reserved_spend_usd,
                "attributed_revenue_usd": state.attributed_revenue_usd,
                "closed_won_count": state.closed_won_count,
                "roas": roas,
                "remaining_ratio_pct": rem_ratio,
                "low_balance_alert_20pct": rem_ratio <= state.alert_threshold_pct,
            }
        )
    return {"brands": items}


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


@app.post("/api/v1/treasury/topup")
def topup_brand_vault(payload: VaultTopupPayload) -> dict:
    try:
        record = treasury_service.topup_vault(
            brand_id=payload.brand_id,
            amount_usd=payload.amount_usd,
            note=payload.note,
        )
        return {
            "entry_id": record.entry_id,
            "brand_id": record.brand_id,
            "amount_usd": record.amount_usd,
            "balance_after_usd": record.balance_after_usd,
            "remaining_ratio_pct": record.remaining_ratio_pct,
        }
    except (TreasuryError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/agents/briefs/generate")
def generate_ai_creative_brief(payload: BriefGeneratePayload) -> dict:
    try:
        brand = treasury_service.get_brand(payload.brand_id)
        brief = creative_director_agent.create_brief(
            brand_id=payload.brand_id,
            industry_vertical=brand.industry_vertical,
            product_or_offer=payload.product_or_offer,
            target_audience_ve=payload.target_audience_ve,
            custom_audio_path=payload.custom_audio_path,
        )
        audit = compliance_auditor_agent.audit_creative(
            brand_id=payload.brand_id,
            industry_vertical=brand.industry_vertical,
            copy_text=brief.direct_response_copy,
        )
        return {
            "brief_id": brief.brief_id,
            "brand_id": brief.brand_id,
            "ai_models_used": brief.ai_models_used,
            "hooks": [asdict(h) for h in brief.hooks],
            "direct_response_copy": audit.approved_copy,
            "nano_banana_flyer_prompt": brief.nano_banana_flyer_prompt,
            "compliance": asdict(audit),
        }
    except (TreasuryError, ComplianceError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/viral-clips/prepare-local")
def prepare_local_viral_clip(payload: ViralLocalClipPayload) -> dict:
    settings = get_settings()
    candidate = str(settings.local_inbox_dir / payload.filename)
    try:
        with video_concurrency_lock.acquire(f"local_{payload.filename}"):
            return viral_clips_service.prepare_local_inbox_clip(
                brand_id=payload.brand_id,
                file_path=candidate,
                start_sec=payload.start_sec,
                end_sec=payload.end_sec,
            )
    except SecurityViolationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (VideoWorkerBusyError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/v1/viral-clips/prepare-youtube")
def prepare_youtube_surgical_clip(payload: ViralYoutubeClipPayload) -> dict:
    try:
        with video_concurrency_lock.acquire(f"yt_{payload.start_timestamp}"):
            return viral_clips_service.prepare_youtube_surgical_clip(
                brand_id=payload.brand_id,
                youtube_url=payload.youtube_url,
                start_timestamp=payload.start_timestamp,
                end_timestamp=payload.end_timestamp,
            )
    except (VideoWorkerBusyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/flyers/generate")
def generate_commercial_flyer(payload: FlyerGeneratePayload) -> dict:
    try:
        res = flyer_pipeline_service.generate_commercial_flyer(
            brand_id=payload.brand_id,
            brand_slug=payload.brand_slug,
            headline=payload.headline,
            price_badge=payload.price_badge,
            cta_text=payload.cta_text,
            nano_banana_prompt=payload.nano_banana_prompt,
            aspect_ratio=payload.aspect_ratio,
        )
        res["dimensions"] = list(res["dimensions"])
        return res
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/v1/hitl/proposals")
def list_hitl_proposals() -> dict:
    return {"proposals": list(trafficker_agent._proposals.values())}


@app.post("/api/v1/hitl/proposals")
def stage_hitl_proposal(payload: HitlStageCampaignPayload) -> dict:
    try:
        return trafficker_agent.stage_campaign_for_hitl(
            brand_id=payload.brand_id,
            ad_account_brand_id=payload.ad_account_brand_id,
            pixel_brand_id=payload.pixel_brand_id,
            platform=payload.platform,
            campaign_name=payload.campaign_name,
            daily_budget_usd=payload.daily_budget_usd,
            copy_text=payload.copy_text,
        )
    except (TreasuryError, ComplianceError, TraffickerGateError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/hitl/{approval_id}/approve")
def approve_hitl_proposal(approval_id: str) -> dict:
    try:
        return trafficker_agent.approve_hitl_and_deploy(
            approval_id=approval_id,
            decided_by="dashboard_operator",
        )
    except (TreasuryError, TraffickerGateError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/hitl/{approval_id}/reject")
def reject_hitl_proposal(approval_id: str) -> dict:
    try:
        return trafficker_agent.reject_hitl_and_release(
            approval_id=approval_id,
            decided_by="dashboard_operator",
        )
    except (TreasuryError, TraffickerGateError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
