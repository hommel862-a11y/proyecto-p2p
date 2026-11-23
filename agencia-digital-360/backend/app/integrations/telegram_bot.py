from app.agents.creative_director import CreativeDirectorAgent
from app.agents.trafficker import TraffickerAgent
from app.services.treasury import TreasuryService


class TelegramHitlBotService:
    """
    Mobile Command Center (Telegram Webhook/Polling).
    Supports:
    - Voice Note ingestion -> Creative Brief generation (Agent 1) + Compliance Audit (Agent 2)
      + Vault Budget Reservation (Agent 4) + Inline HITL Keyboard card.
    - 1-Click Inline Callback Buttons (HITL_APPROVE_SPEND, HITL_REJECT_SPEND, HITL_APPROVE_RENDER).
    """

    def __init__(
        self,
        treasury: TreasuryService,
        creative_director: CreativeDirectorAgent,
        trafficker: TraffickerAgent,
    ) -> None:
        self._treasury = treasury
        self._creative_director = creative_director
        self._trafficker = trafficker

    @staticmethod
    def build_hitl_inline_keyboard(approval_id: str, campaign_id: str, budget_usd: float) -> list[list[dict]]:
        return [
            [
                {
                    "text": f"Aprobar y Publicar Pauta (${budget_usd:.2f})",
                    "callback_data": f"HITL_APPROVE_SPEND:{approval_id}",
                }
            ],
            [
                {
                    "text": "Renderizar Gancho B (c=1)",
                    "callback_data": f"HITL_APPROVE_RENDER:{approval_id}",
                },
                {
                    "text": "Rechazar / Liberar Bóveda",
                    "callback_data": f"HITL_REJECT_SPEND:{approval_id}",
                },
            ],
            [
                {
                    "text": "Pausar Campaña",
                    "callback_data": f"HITL_PAUSE_CAMPAIGN:{campaign_id}",
                }
            ],
        ]

    def handle_voice_note_brief(
        self,
        chat_id: str,
        brand_id: str,
        voice_transcript: str,
        requested_budget_usd: float,
        platform: str = "META_ADS",
    ) -> dict:
        brand = self._treasury.get_brand(brand_id)
        brief = self._creative_director.create_brief(
            brand_id=brand_id,
            industry_vertical=brand.industry_vertical,
            product_or_offer=voice_transcript,
            target_audience_ve="Venezuela & LATAM",
        )
        proposal = self._trafficker.stage_campaign_for_hitl(
            brand_id=brand_id,
            ad_account_brand_id=brand_id,
            pixel_brand_id=brand_id,
            platform=platform,
            campaign_name=f"tg_voice_{brief.brief_id}",
            daily_budget_usd=requested_budget_usd,
            copy_text=brief.direct_response_copy,
        )
        keyboard = self.build_hitl_inline_keyboard(
            approval_id=proposal["approval_id"],
            campaign_id=proposal["campaign_id"],
            budget_usd=requested_budget_usd,
        )
        return {
            "status": "HITL_APPROVAL_REQUESTED",
            "chat_id": chat_id,
            "brand_id": brand_id,
            "brief_id": brief.brief_id,
            "approval_id": proposal["approval_id"],
            "campaign_id": proposal["campaign_id"],
            "compliance_status": proposal["compliance_status"],
            "low_balance_alert_20pct": proposal["low_balance_alert_20pct"],
            "inline_keyboard": keyboard,
        }

    def handle_callback_query(self, chat_id: str, callback_data: str) -> dict:
        if ":" not in callback_data:
            raise ValueError(f"Malformed callback_data: {callback_data}")
        action, target_id = callback_data.split(":", 1)

        if action == "HITL_APPROVE_SPEND":
            deployed = self._trafficker.approve_hitl_and_deploy(target_id, decided_by=chat_id)
            return {
                "callback_action": action,
                "approval_id": target_id,
                "approval_status": deployed["hitl_status"],
                "campaign_status": deployed["status"],
                "external_ad_id": deployed["external_ad_id"],
                "committed_spend_usd": deployed["committed_spend_usd"],
            }

        if action == "HITL_REJECT_SPEND":
            rejected = self._trafficker.reject_hitl_and_release(target_id, decided_by=chat_id)
            return {
                "callback_action": action,
                "approval_id": target_id,
                "approval_status": rejected["hitl_status"],
                "campaign_status": rejected["status"],
                "committed_spend_usd": 0.0,
            }

        if action == "HITL_APPROVE_RENDER":
            return {
                "callback_action": action,
                "approval_id": target_id,
                "render_queue": "video_heavy",
                "concurrency_limit": 1,
                "status": "QUEUED_FOR_RENDER",
            }

        if action == "HITL_PAUSE_CAMPAIGN":
            return {
                "callback_action": action,
                "campaign_id": target_id,
                "campaign_status": "PAUSED_BY_OPERATOR",
            }

        raise ValueError(f"Unsupported Telegram HITL callback action: {action}")
