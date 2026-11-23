from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.core.config import now_vet

IndustryVertical = Literal[
    "RETAIL_COMMERCE",
    "CASHEA_ALLY",
    "FINTECH_P2P",
    "B2B_SERVICES",
    "EDUCATION",
]

AdPlatform = Literal["META_ADS", "TIKTOK_ADS", "YOUTUBE_ADS"]
HookVariant = Literal["HOOK_A", "HOOK_B", "HOOK_C"]


class BrandCreateRequest(BaseModel):
    slug: str = Field(..., min_length=3, max_length=64)
    display_name: str = Field(..., min_length=2, max_length=120)
    industry_vertical: IndustryVertical
    spend_cap_usd: float = Field(default=500.0, gt=0)
    vault_balance_usd: float = Field(default=0.0, ge=0)
    alert_threshold_pct: float = Field(default=20.0, ge=5.0, le=50.0)


class ArmOutboundAttributionPayload(BaseModel):
    event: Literal["ad_lead_attributed"] = "ad_lead_attributed"
    idempotency_key: str = Field(..., min_length=12)
    brand_id: str
    platform: AdPlatform
    campaign_id: str
    ad_id: str
    hook_variant: HookVariant = "HOOK_A"
    contact_phone: Optional[str] = None
    ctwa_clid: Optional[str] = None
    timestamp_vet: datetime = Field(default_factory=now_vet)


class ArmInboundClosedWonPayload(BaseModel):
    event: Literal["closed_won"] = "closed_won"
    idempotency_key: str = Field(..., min_length=12)
    brand_id: str
    deal_id: str
    campaign_id: str
    ad_id: str
    amount_usd: float = Field(..., gt=0)
    currency_original: Literal["USD", "USDT", "VES_BCV"] = "USD"
    trigger_server_side_capi: bool = True
    closed_at_vet: datetime = Field(default_factory=now_vet)
