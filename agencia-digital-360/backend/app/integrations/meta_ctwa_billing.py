from typing import Any, Optional
import httpx


def build_ctwa_5step_plan(
    brand_id: str,
    ad_account_id: str,
    page_id: str,
    whatsapp_phone: str,
    campaign_name: str,
    daily_budget_usd: float,
    video_public_url: str,
    copy_text: str,
    tracking_code: str,
    country_code: str = "VE",
) -> dict[str, Any]:
    """
    Constructs the exact 5-step Meta Marketing API v21.0 Click-to-WhatsApp (CTWA)
    deployment plan so operators launch campaigns directly from Agencia Digital 360
    without opening Facebook Ads Manager.
    """
    act = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
    budget_cents = int(round(float(daily_budget_usd) * 100))
    prefilled_msg = f"Hola, quiero información sobre esta oferta [{tracking_code}]."

    return {
        "brand_id": brand_id,
        "ad_account_id": act,
        "graph_api_version": "v21.0",
        "destination": "WHATSAPP_CTWA",
        "steps": [
            {
                "step": 1,
                "endpoint": f"POST https://graph.facebook.com/v21.0/{act}/advideos",
                "payload": {
                    "file_url": video_public_url,
                    "title": f"{campaign_name} ({tracking_code})",
                },
            },
            {
                "step": 2,
                "endpoint": f"POST https://graph.facebook.com/v21.0/{act}/campaigns",
                "payload": {
                    "name": campaign_name,
                    "objective": "OUTCOME_ENGAGEMENT",
                    "status": "PAUSED",
                    "special_ad_categories": [],
                },
            },
            {
                "step": 3,
                "endpoint": f"POST https://graph.facebook.com/v21.0/{act}/adsets",
                "payload": {
                    "name": f"{campaign_name} - AdSet VE",
                    "billing_event": "IMPRESSIONS",
                    "optimization_goal": "CONVERSATIONS",
                    "destination_type": "WHATSAPP",
                    "daily_budget": budget_cents,
                    "promoted_object": {
                        "page_id": page_id,
                        "whatsapp_phone_number": whatsapp_phone,
                    },
                    "targeting": {
                        "geo_locations": {"countries": [country_code]},
                        "publisher_platforms": ["facebook", "instagram"],
                        "instagram_positions": ["reels", "story", "stream"],
                    },
                    "status": "PAUSED",
                },
            },
            {
                "step": 4,
                "endpoint": f"POST https://graph.facebook.com/v21.0/{act}/adcreatives",
                "payload": {
                    "name": f"Creative {tracking_code}",
                    "object_story_spec": {
                        "page_id": page_id,
                        "video_data": {
                            "message": copy_text,
                            "call_to_action": {
                                "type": "WHATSAPP_MESSAGE",
                                "value": {"app_destination": "WHATSAPP"},
                            },
                        },
                    },
                    "prefilled_whatsapp_message": prefilled_msg,
                },
            },
            {
                "step": 5,
                "endpoint": f"POST https://graph.facebook.com/v21.0/{act}/ads",
                "payload": {
                    "name": f"Ad {tracking_code}",
                    "status": "PAUSED",
                    "requires_hitl_activation": True,
                },
            },
        ],
    }


def evaluate_card_mirror_killswitch(
    card_funded_usd: float,
    meta_amount_spent_usd: float,
    alert_pct: float = 80.0,
    killswitch_pct: float = 95.0,
) -> dict[str, Any]:
    """
    Card Mirror Billing Guard for Venezuela/LATAM prepaid USD cards (Wally, Zinli,
    Facebank, Banesco/Mercantil Panama). Prevents Meta ad account restrictions caused
    by failed card charges by alerting at 80% consumed and auto-pausing AdSets at 95%.
    """
    funded = max(0.0, round(float(card_funded_usd), 2))
    spent = max(0.0, round(float(meta_amount_spent_usd), 2))

    if funded <= 0.0:
        return {
            "card_funded_usd": 0.0,
            "meta_amount_spent_usd": spent,
            "remaining_usd": 0.0,
            "consumed_pct": 100.0 if spent > 0 else 0.0,
            "action": "UNFUNDED_PAUSED",
            "should_alert_telegram": spent > 0,
            "should_pause_active_adsets": True,
        }

    remaining = max(0.0, round(funded - spent, 2))
    consumed_pct = round((spent / funded) * 100.0, 2)

    if consumed_pct >= killswitch_pct:
        action = "AUTO_PAUSE_KILLSWITCH"
        should_alert = True
        should_pause = True
    elif consumed_pct >= alert_pct:
        action = "ALERT_RECHARGE_CARD"
        should_alert = True
        should_pause = False
    else:
        action = "SAFE"
        should_alert = False
        should_pause = False

    return {
        "card_funded_usd": funded,
        "meta_amount_spent_usd": spent,
        "remaining_usd": remaining,
        "consumed_pct": consumed_pct,
        "action": action,
        "should_alert_telegram": should_alert,
        "should_pause_active_adsets": should_pause,
    }


async def execute_ctwa_live_deploy(
    access_token: str,
    brand_id: str,
    ad_account_id: str,
    page_id: str,
    whatsapp_phone: str,
    campaign_name: str,
    daily_budget_usd: float,
    video_public_url: str,
    copy_text: str,
    tracking_code: str,
    country_code: str = "VE",
) -> dict[str, Any]:
    """
    Executes the real 5-step Meta Marketing API v21.0 Click-to-WhatsApp campaign
    creation sequence over HTTPS so operators never have to open Facebook Ads Manager.
    """
    plan = build_ctwa_5step_plan(
        brand_id=brand_id,
        ad_account_id=ad_account_id,
        page_id=page_id,
        whatsapp_phone=whatsapp_phone,
        campaign_name=campaign_name,
        daily_budget_usd=daily_budget_usd,
        video_public_url=video_public_url,
        copy_text=copy_text,
        tracking_code=tracking_code,
        country_code=country_code,
    )
    act = plan["ad_account_id"]
    base = f"https://graph.facebook.com/v21.0/{act}"

    async with httpx.AsyncClient(timeout=25.0) as client:
        # Step 1: Upload Video
        r1 = await client.post(f"{base}/advideos", data={**plan["steps"][0]["payload"], "access_token": access_token})
        if r1.status_code >= 300:
            return {"ok": False, "failed_step": 1, "detail": r1.text[:240]}
        video_id = r1.json().get("id")

        # Step 2: Create Campaign (PAUSED)
        r2 = await client.post(f"{base}/campaigns", json={**plan["steps"][1]["payload"], "access_token": access_token})
        if r2.status_code >= 300:
            return {"ok": False, "failed_step": 2, "detail": r2.text[:240]}
        campaign_id = r2.json().get("id")

        # Step 3: Create WhatsApp CTWA AdSet
        adset_payload = {**plan["steps"][2]["payload"], "campaign_id": campaign_id, "access_token": access_token}
        r3 = await client.post(f"{base}/adsets", json=adset_payload)
        if r3.status_code >= 300:
            return {"ok": False, "failed_step": 3, "detail": r3.text[:240]}
        adset_id = r3.json().get("id")

        # Step 4: Create Creative with video_id & WHATSAPP_MESSAGE CTA
        cre_payload = {**plan["steps"][3]["payload"], "access_token": access_token}
        cre_payload["object_story_spec"]["video_data"]["video_id"] = video_id
        r4 = await client.post(f"{base}/adcreatives", json=cre_payload)
        if r4.status_code >= 300:
            return {"ok": False, "failed_step": 4, "detail": r4.text[:240]}
        creative_id = r4.json().get("id")

        # Step 5: Create Ad (PAUSED until HITL activation)
        ad_payload = {
            "name": plan["steps"][4]["payload"]["name"],
            "adset_id": adset_id,
            "creative": {"creative_id": creative_id},
            "status": "PAUSED",
            "access_token": access_token,
        }
        r5 = await client.post(f"{base}/ads", json=ad_payload)
        if r5.status_code >= 300:
            return {"ok": False, "failed_step": 5, "detail": r5.text[:240]}
        ad_id = r5.json().get("id")

    return {
        "ok": True,
        "brand_id": brand_id,
        "tracking_code": tracking_code,
        "meta_ids": {
            "video_id": video_id,
            "campaign_id": campaign_id,
            "adset_id": adset_id,
            "creative_id": creative_id,
            "ad_id": ad_id,
        },
    }


async def send_telegram_hitl_alert(
    bot_token: str,
    chat_id: str,
    text: str,
    reply_markup: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Sends a real Telegram alert or HITL inline approval card via Bot API."""
    body: dict[str, Any] = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}
    if reply_markup:
        body["reply_markup"] = reply_markup

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", json=body)
        if res.status_code >= 300:
            return {"ok": False, "status_code": res.status_code, "detail": res.text[:200]}
        data = res.json()
        return {"ok": bool(data.get("ok")), "message_id": data.get("result", {}).get("message_id")}

