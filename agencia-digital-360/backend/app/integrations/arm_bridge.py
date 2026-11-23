import json
import time
from typing import Optional
from app.core.security import sign_arm_webhook_payload, verify_arm_webhook_signature
from app.services.treasury import TreasuryService
from app.integrations.meta_ads import MetaAdsIntegration


class ArmWebhookAuthError(Exception):
    """Raised when an ARM <-> Agencia webhook fails HMAC or anti-replay verification."""


class ArmBridgeService:
    """
    Architectural Constraint #1:
    100% Decoupled Agencia Digital 360 <-> ARM Webhook Bridge.
    - Outbound: Dispatches signed `ad_lead_attributed` (ad_id, campaign_id) to ARM.
    - Inbound: Verifies signed `closed_won` from ARM, deduplicates by idempotency_key,
      credits real ROAS in TreasuryService, and fires server-side Meta CAPI Purchase.
    """

    def __init__(
        self,
        treasury: TreasuryService,
        meta_ads: MetaAdsIntegration,
        hmac_secret: str,
    ) -> None:
        self._treasury = treasury
        self._meta_ads = meta_ads
        self._hmac_secret = hmac_secret
        self._processed_idempotency_keys: dict[str, dict] = {}

    def build_outbound_lead_attribution_envelope(
        self,
        brand_id: str,
        campaign_id: str,
        ad_id: str,
        platform: str,
        idempotency_key: str,
        contact_phone: Optional[str] = None,
        ctwa_clid: Optional[str] = None,
        timestamp: Optional[int] = None,
    ) -> dict:
        ts = int(timestamp if timestamp is not None else time.time())
        body_dict = {
            "event": "ad_lead_attributed",
            "idempotency_key": idempotency_key,
            "brand_id": brand_id,
            "platform": platform,
            "campaign_id": campaign_id,
            "ad_id": ad_id,
            "contact_phone": contact_phone,
            "ctwa_clid": ctwa_clid,
        }
        raw_bytes = json.dumps(body_dict, separators=(",", ":")).encode("utf-8")
        signature = sign_arm_webhook_payload(raw_bytes, secret=self._hmac_secret, timestamp=ts)
        return {
            "headers": {
                "Content-Type": "application/json",
                "X-Agencia360-Signature": signature,
                "X-Agencia360-Timestamp": str(ts),
                "X-Idempotency-Key": idempotency_key,
            },
            "payload": body_dict,
        }

    def process_inbound_closed_won(
        self,
        raw_body: bytes,
        signature_header: str,
        timestamp_header: int,
        idempotency_key: str,
        now_epoch: Optional[int] = None,
    ) -> dict:
        if not verify_arm_webhook_signature(
            payload=raw_body,
            signature_header=signature_header,
            timestamp=timestamp_header,
            secret=self._hmac_secret,
            now_epoch=now_epoch,
        ):
            raise ArmWebhookAuthError("Invalid HMAC-SHA256 signature or expired timestamp window")

        if idempotency_key in self._processed_idempotency_keys:
            cached = dict(self._processed_idempotency_keys[idempotency_key])
            cached["status"] = "DUPLICATE_IGNORED"
            return cached

        payload = json.loads(raw_body.decode("utf-8"))
        if payload.get("event") != "closed_won":
            raise ValueError(f"Unsupported inbound ARM event: {payload.get('event')}")

        roas_summary = self._treasury.record_arm_closed_won_revenue(
            brand_id=payload["brand_id"],
            campaign_id=payload["campaign_id"],
            ad_id=payload["ad_id"],
            deal_id=payload["deal_id"],
            amount_usd=float(payload["amount_usd"]),
        )

        capi_dispatched = False
        capi_event = None
        if payload.get("trigger_server_side_capi", True):
            capi_event = self._meta_ads.build_capi_purchase_event(
                brand_id=payload["brand_id"],
                pixel_id=payload.get("pixel_id", f"px_{payload['brand_id']}"),
                deal_id=payload["deal_id"],
                ad_id=payload["ad_id"],
                amount_usd=float(payload["amount_usd"]),
                contact_phone=payload.get("contact_phone"),
                ctwa_clid=payload.get("ctwa_clid"),
                event_time=timestamp_header,
            )
            capi_dispatched = True

        result = {
            "status": "PROCESSED",
            "idempotency_key": idempotency_key,
            "brand_id": payload["brand_id"],
            "deal_id": payload["deal_id"],
            "campaign_id": payload["campaign_id"],
            "ad_id": payload["ad_id"],
            "attributed_revenue_usd": roas_summary["attributed_revenue_usd"],
            "accumulated_spend_usd": roas_summary["accumulated_spend_usd"],
            "roas": roas_summary["roas"],
            "capi_purchase_dispatched": capi_dispatched,
            "capi_event": capi_event,
        }
        self._processed_idempotency_keys[idempotency_key] = result
        return result
