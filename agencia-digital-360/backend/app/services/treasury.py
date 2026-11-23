from dataclasses import dataclass, field
from datetime import datetime
import uuid
from typing import Optional
from app.core.config import now_vet


class TreasuryError(Exception):
    """Base exception for Ad Treasury Ledger and Vault operations."""


class SpendCapExceededError(TreasuryError):
    """Raised when a requested ad spend would exceed the brand's hard spend_cap_usd."""


class InsufficientVaultFundsError(TreasuryError):
    """Raised when the brand's vault balance cannot cover the requested reservation."""


class HitlApprovalRequiredError(TreasuryError):
    """Raised when an operation attempts to commit spend without an APPROVED HITL state."""


@dataclass
class BrandVaultState:
    brand_id: str
    slug: str
    display_name: str
    industry_vertical: str
    spend_cap_usd: float
    vault_balance_usd: float
    alert_threshold_pct: float = 20.0
    accumulated_spend_usd: float = 0.0
    reserved_spend_usd: float = 0.0
    attributed_revenue_usd: float = 0.0
    closed_won_count: int = 0


@dataclass
class TreasuryLedgerRecord:
    entry_id: str
    brand_id: str
    campaign_id: Optional[str]
    entry_type: str
    amount_usd: float
    balance_after_usd: float
    remaining_ratio_pct: float
    low_balance_alert_triggered: bool = False
    reservation_id: Optional[str] = None
    reference_note: str = ""
    created_at_vet: datetime = field(default_factory=now_vet)


class TreasuryService:
    """
    Double-entry Ad Treasury Ledger (`ad_treasury_ledger`) with isolated per-brand
    spend_cap enforcement, atomic HITL budget reservations, and automatic 20%
    low-balance circuit-breaker alerts.
    """

    def __init__(self) -> None:
        self._brands: dict[str, BrandVaultState] = {}
        self._reservations: dict[str, dict] = {}
        self._ledger: list[TreasuryLedgerRecord] = []

    def register_brand(
        self,
        brand_id: str,
        slug: str,
        display_name: str,
        industry_vertical: str,
        spend_cap_usd: float,
        initial_vault_usd: float = 0.0,
        alert_threshold_pct: float = 20.0,
    ) -> BrandVaultState:
        if spend_cap_usd <= 0:
            raise ValueError("spend_cap_usd must be positive")
        state = BrandVaultState(
            brand_id=brand_id,
            slug=slug,
            display_name=display_name,
            industry_vertical=industry_vertical,
            spend_cap_usd=round(float(spend_cap_usd), 2),
            vault_balance_usd=round(float(initial_vault_usd), 2),
            alert_threshold_pct=round(float(alert_threshold_pct), 2),
        )
        self._brands[brand_id] = state
        if initial_vault_usd > 0:
            self._append_entry(
                brand_id=brand_id,
                campaign_id=None,
                entry_type="VAULT_TOPUP",
                amount_usd=initial_vault_usd,
                balance_after_usd=state.vault_balance_usd,
                remaining_ratio_pct=100.0,
                low_balance_alert_triggered=False,
                reference_note="Initial brand vault funding",
            )
        return state

    def get_brand(self, brand_id: str) -> BrandVaultState:
        if brand_id not in self._brands:
            raise TreasuryError(f"Brand '{brand_id}' is not registered in treasury")
        return self._brands[brand_id]

    def topup_vault(self, brand_id: str, amount_usd: float, note: str = "USDT Top-up") -> TreasuryLedgerRecord:
        if amount_usd <= 0:
            raise ValueError("Top-up amount must be positive")
        brand = self.get_brand(brand_id)
        brand.vault_balance_usd = round(brand.vault_balance_usd + amount_usd, 2)
        remaining_cap = max(0.0, brand.spend_cap_usd - (brand.accumulated_spend_usd + brand.reserved_spend_usd))
        ratio = round((remaining_cap / brand.spend_cap_usd) * 100.0, 2)
        return self._append_entry(
            brand_id=brand_id,
            campaign_id=None,
            entry_type="VAULT_TOPUP",
            amount_usd=round(amount_usd, 2),
            balance_after_usd=brand.vault_balance_usd,
            remaining_ratio_pct=ratio,
            low_balance_alert_triggered=False,
            reference_note=note,
        )

    def reserve_for_hitl(
        self,
        brand_id: str,
        campaign_id: str,
        requested_usd: float,
    ) -> TreasuryLedgerRecord:
        if requested_usd <= 0:
            raise ValueError("requested_usd must be > 0")
        brand = self.get_brand(brand_id)
        req = round(float(requested_usd), 2)

        projected_total_spend = round(brand.accumulated_spend_usd + brand.reserved_spend_usd + req, 2)
        if projected_total_spend > brand.spend_cap_usd:
            raise SpendCapExceededError(
                f"Requested ${req:.2f} breaches brand '{brand_id}' spend_cap_usd "
                f"(${projected_total_spend:.2f} > ${brand.spend_cap_usd:.2f})"
            )

        available_vault = round(brand.vault_balance_usd - brand.reserved_spend_usd, 2)
        if req > available_vault:
            raise InsufficientVaultFundsError(
                f"Insufficient vault funds for brand '{brand_id}': requested ${req:.2f}, available ${available_vault:.2f}"
            )

        brand.reserved_spend_usd = round(brand.reserved_spend_usd + req, 2)
        remaining_cap = round(brand.spend_cap_usd - projected_total_spend, 2)
        remaining_ratio_pct = round((remaining_cap / brand.spend_cap_usd) * 100.0, 2)
        low_alert = remaining_ratio_pct <= brand.alert_threshold_pct

        reservation_id = f"rsv_{uuid.uuid4().hex[:12]}"
        self._reservations[reservation_id] = {
            "reservation_id": reservation_id,
            "brand_id": brand_id,
            "campaign_id": campaign_id,
            "amount_usd": req,
            "status": "RESERVED_PENDING_HITL",
        }

        record = self._append_entry(
            brand_id=brand_id,
            campaign_id=campaign_id,
            entry_type="HITL_RESERVATION",
            amount_usd=-req,
            balance_after_usd=round(brand.vault_balance_usd - brand.reserved_spend_usd, 2),
            remaining_ratio_pct=remaining_ratio_pct,
            low_balance_alert_triggered=low_alert,
            reservation_id=reservation_id,
            reference_note=f"HITL reservation for campaign {campaign_id}",
        )

        if low_alert:
            self._append_entry(
                brand_id=brand_id,
                campaign_id=campaign_id,
                entry_type="LOW_BALANCE_20PCT_ALERT",
                amount_usd=0.0,
                balance_after_usd=round(brand.vault_balance_usd - brand.reserved_spend_usd, 2),
                remaining_ratio_pct=remaining_ratio_pct,
                low_balance_alert_triggered=True,
                reservation_id=reservation_id,
                reference_note=f"20% low-balance threshold reached ({remaining_ratio_pct}% remaining)",
            )
        return record

    def commit_approved_spend(
        self,
        brand_id: str,
        reservation_id: str,
        hitl_status: str,
    ) -> TreasuryLedgerRecord:
        if hitl_status != "APPROVED":
            raise HitlApprovalRequiredError(
                f"HITL approval required before committing spend (got status='{hitl_status}')"
            )
        rsv = self._reservations.get(reservation_id)
        if not rsv or rsv["brand_id"] != brand_id:
            raise TreasuryError(f"Reservation '{reservation_id}' not found for brand '{brand_id}'")
        if rsv["status"] != "RESERVED_PENDING_HITL":
            raise TreasuryError(f"Reservation '{reservation_id}' already settled ({rsv['status']})")

        brand = self.get_brand(brand_id)
        amount = rsv["amount_usd"]
        brand.reserved_spend_usd = round(brand.reserved_spend_usd - amount, 2)
        brand.vault_balance_usd = round(brand.vault_balance_usd - amount, 2)
        brand.accumulated_spend_usd = round(brand.accumulated_spend_usd + amount, 2)
        rsv["status"] = "COMMITTED"

        remaining_cap = round(brand.spend_cap_usd - (brand.accumulated_spend_usd + brand.reserved_spend_usd), 2)
        remaining_ratio_pct = round((remaining_cap / brand.spend_cap_usd) * 100.0, 2)
        low_alert = remaining_ratio_pct <= brand.alert_threshold_pct

        return self._append_entry(
            brand_id=brand_id,
            campaign_id=rsv["campaign_id"],
            entry_type="SPEND_COMMITTED",
            amount_usd=-amount,
            balance_after_usd=brand.vault_balance_usd,
            remaining_ratio_pct=remaining_ratio_pct,
            low_balance_alert_triggered=low_alert,
            reservation_id=reservation_id,
            reference_note=f"Committed HITL-approved spend for {rsv['campaign_id']}",
        )

    def release_rejected_reservation(self, brand_id: str, reservation_id: str) -> TreasuryLedgerRecord:
        rsv = self._reservations.get(reservation_id)
        if not rsv or rsv["brand_id"] != brand_id:
            raise TreasuryError(f"Reservation '{reservation_id}' not found for brand '{brand_id}'")
        if rsv["status"] != "RESERVED_PENDING_HITL":
            raise TreasuryError(f"Reservation '{reservation_id}' cannot be released ({rsv['status']})")

        brand = self.get_brand(brand_id)
        amount = rsv["amount_usd"]
        brand.reserved_spend_usd = round(brand.reserved_spend_usd - amount, 2)
        rsv["status"] = "RELEASED"

        remaining_cap = round(brand.spend_cap_usd - (brand.accumulated_spend_usd + brand.reserved_spend_usd), 2)
        remaining_ratio_pct = round((remaining_cap / brand.spend_cap_usd) * 100.0, 2)

        return self._append_entry(
            brand_id=brand_id,
            campaign_id=rsv["campaign_id"],
            entry_type="RESERVATION_RELEASED",
            amount_usd=amount,
            balance_after_usd=round(brand.vault_balance_usd - brand.reserved_spend_usd, 2),
            remaining_ratio_pct=remaining_ratio_pct,
            low_balance_alert_triggered=False,
            reservation_id=reservation_id,
            reference_note=f"Released rejected HITL reservation for {rsv['campaign_id']}",
        )

    def record_arm_closed_won_revenue(
        self,
        brand_id: str,
        campaign_id: str,
        ad_id: str,
        deal_id: str,
        amount_usd: float,
    ) -> dict:
        if amount_usd <= 0:
            raise ValueError("amount_usd must be > 0")
        brand = self.get_brand(brand_id)
        rev = round(float(amount_usd), 2)
        brand.attributed_revenue_usd = round(brand.attributed_revenue_usd + rev, 2)
        brand.closed_won_count += 1

        remaining_cap = round(brand.spend_cap_usd - (brand.accumulated_spend_usd + brand.reserved_spend_usd), 2)
        remaining_ratio_pct = round((remaining_cap / brand.spend_cap_usd) * 100.0, 2)

        self._append_entry(
            brand_id=brand_id,
            campaign_id=campaign_id,
            entry_type="ARM_CLOSED_WON_RETURN",
            amount_usd=rev,
            balance_after_usd=brand.vault_balance_usd,
            remaining_ratio_pct=remaining_ratio_pct,
            low_balance_alert_triggered=False,
            reference_note=f"ARM closed_won deal={deal_id} ad_id={ad_id}",
        )

        roas = (
            round(brand.attributed_revenue_usd / brand.accumulated_spend_usd, 2)
            if brand.accumulated_spend_usd > 0
            else 0.0
        )
        return {
            "brand_id": brand_id,
            "campaign_id": campaign_id,
            "ad_id": ad_id,
            "deal_id": deal_id,
            "attributed_revenue_usd": brand.attributed_revenue_usd,
            "accumulated_spend_usd": brand.accumulated_spend_usd,
            "closed_won_count": brand.closed_won_count,
            "roas": roas,
        }

    def get_brand_ledger(self, brand_id: str) -> list[TreasuryLedgerRecord]:
        return [e for e in self._ledger if e.brand_id == brand_id]

    def _append_entry(
        self,
        brand_id: str,
        campaign_id: Optional[str],
        entry_type: str,
        amount_usd: float,
        balance_after_usd: float,
        remaining_ratio_pct: float,
        low_balance_alert_triggered: bool,
        reservation_id: Optional[str] = None,
        reference_note: str = "",
    ) -> TreasuryLedgerRecord:
        record = TreasuryLedgerRecord(
            entry_id=f"led_{uuid.uuid4().hex[:12]}",
            brand_id=brand_id,
            campaign_id=campaign_id,
            entry_type=entry_type,
            amount_usd=amount_usd,
            balance_after_usd=balance_after_usd,
            remaining_ratio_pct=remaining_ratio_pct,
            low_balance_alert_triggered=low_balance_alert_triggered,
            reservation_id=reservation_id,
            reference_note=reference_note,
        )
        self._ledger.append(record)
        return record
