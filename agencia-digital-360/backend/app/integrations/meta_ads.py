import hashlib
import re
import time
from typing import Optional
from app.core.security import BrandCredentialVault


class MetaAdsIntegration:
    """
    Meta Graph API, Marketing API, Ad Library & Server-Side Conversions API (CAPI).
    Enforces per-brand encrypted credential isolation via BrandCredentialVault.
    """

    def __init__(self, credential_vault: Optional[BrandCredentialVault] = None) -> None:
        self._vault = credential_vault

    def build_916_reel_campaign_payload(
        self,
        brand_id: str,
        ad_account_id: str,
        page_id: str,
        pixel_id: str,
        encrypted_access_token: str,
        campaign_name: str,
        daily_budget_usd: float,
        video_public_https_url: str,
        copy_text: str,
    ) -> dict:
        if self._vault is not None:
            # Verify cryptographic brand binding (throws SecurityViolationError on cross-brand leak)
            _ = self._vault.decrypt_for_brand(brand_id, encrypted_access_token)

        return {
            "brand_id": brand_id,
            "ad_account_id": ad_account_id,
            "page_id": page_id,
            "pixel_id": pixel_id,
            "campaign": {
                "name": campaign_name,
                "objective": "OUTCOME_SALES",
                "status": "PAUSED",
                "special_ad_categories": [],
            },
            "adset": {
                "billing_event": "IMPRESSIONS",
                "optimization_goal": "OFFSITE_CONVERSIONS",
                "daily_budget_cents": int(round(daily_budget_usd * 100)),
                "targeting": {
                    "geo_locations": {"countries": ["VE"]},
                    "publisher_platforms": ["facebook", "instagram"],
                    "instagram_positions": ["reels", "story", "stream"],
                },
            },
            "creative": {
                "aspect_ratio": "9:16",
                "video_url": video_public_https_url,
                "message": copy_text,
            },
            "daily_budget_cents": int(round(daily_budget_usd * 100)),
        }

    def build_ad_library_search_params(self, search_terms: str, country_code: str = "VE") -> dict:
        return {
            "search_terms": search_terms,
            "ad_reached_countries": [country_code],
            "ad_active_status": "ACTIVE",
            "media_type": "VIDEO",
            "fields": "id,page_name,ad_creative_bodies,ad_delivery_start_time",
        }

    def build_capi_purchase_event(
        self,
        brand_id: str,
        pixel_id: str,
        deal_id: str,
        ad_id: str,
        amount_usd: float,
        contact_phone: Optional[str] = None,
        ctwa_clid: Optional[str] = None,
        event_time: Optional[int] = None,
    ) -> dict:
        user_data: dict = {}
        if contact_phone:
            digits = re.sub(r"\D+", "", contact_phone)
            hashed_phone = hashlib.sha256(digits.encode("utf-8")).hexdigest()
            user_data["ph"] = [hashed_phone]
        if ctwa_clid:
            user_data["ctwa_clid"] = ctwa_clid

        return {
            "brand_id": brand_id,
            "pixel_id": pixel_id,
            "data": [
                {
                    "event_name": "Purchase",
                    "event_time": int(event_time if event_time is not None else time.time()),
                    "event_id": f"capi_{deal_id}_{ad_id}",
                    "action_source": "business_messaging",
                    "messaging_channel": "whatsapp",
                    "user_data": user_data,
                    "custom_data": {
                        "currency": "USD",
                        "value": round(float(amount_usd), 2),
                        "order_id": deal_id,
                        "ad_id": ad_id,
                    },
                }
            ],
        }
