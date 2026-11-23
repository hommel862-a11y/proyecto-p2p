from app.services.treasury import TreasuryService, TreasuryLedgerRecord


class VaultControllerAgent:
    """
    Agent 4 — Controlador de Bóveda.
    Guards every ad budget request and bulk render against the brand's spend_cap_usd
    and emits priority alerts when remaining capacity drops to <= 20%.
    """

    def __init__(self, treasury: TreasuryService) -> None:
        self._treasury = treasury

    def authorize_and_reserve_budget(
        self,
        brand_id: str,
        campaign_id: str,
        requested_usd: float,
    ) -> dict:
        record: TreasuryLedgerRecord = self._treasury.reserve_for_hitl(
            brand_id=brand_id,
            campaign_id=campaign_id,
            requested_usd=requested_usd,
        )
        return {
            "reservation_id": record.reservation_id,
            "brand_id": brand_id,
            "campaign_id": campaign_id,
            "reserved_usd": abs(record.amount_usd),
            "balance_after_usd": record.balance_after_usd,
            "remaining_ratio_pct": record.remaining_ratio_pct,
            "low_balance_alert_20pct": record.low_balance_alert_triggered,
        }
