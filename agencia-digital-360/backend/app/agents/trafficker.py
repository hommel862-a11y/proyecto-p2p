import uuid
from app.services.treasury import TreasuryService
from app.agents.compliance_auditor import ComplianceAuditorAgent
from app.agents.vault_controller import VaultControllerAgent


class TraffickerGateError(Exception):
    """Raised when an ad campaign deployment violates HITL, Compliance, or Vault gates."""


class TraffickerAgent:
    """
    Agent 3 — Trafficker Multi-Plataforma.
    Enforces:
    1. Per-brand asset isolation (ComplianceAuditorAgent.verify_asset_isolation)
    2. Pre-flight compliance audit
    3. Vault budget reservation via VaultControllerAgent
    4. Mandatory Human-in-the-Loop (HITL) approval before any ad spend goes ACTIVE
    """

    def __init__(
        self,
        treasury: TreasuryService,
        auditor: ComplianceAuditorAgent,
        vault_controller: VaultControllerAgent,
    ) -> None:
        self._treasury = treasury
        self._auditor = auditor
        self._vault_controller = vault_controller
        self._proposals: dict[str, dict] = {}

    def stage_campaign_for_hitl(
        self,
        brand_id: str,
        ad_account_brand_id: str,
        pixel_brand_id: str,
        platform: str,
        campaign_name: str,
        daily_budget_usd: float,
        copy_text: str,
    ) -> dict:
        # Gate 1: Asset isolation across brands
        self._auditor.verify_asset_isolation(
            campaign_brand_id=brand_id,
            ad_account_brand_id=ad_account_brand_id,
            pixel_brand_id=pixel_brand_id,
        )

        brand = self._treasury.get_brand(brand_id)

        # Gate 2: Pre-flight AI compliance check
        audit = self._auditor.audit_creative(
            brand_id=brand_id,
            industry_vertical=brand.industry_vertical,
            copy_text=copy_text,
        )
        if audit.status == "REJECTED":
            raise TraffickerGateError(f"Creative rejected by Compliance Auditor: {audit.notes}")

        # Gate 3: Reserve budget in isolated brand vault
        campaign_id = f"cmp_{uuid.uuid4().hex[:10]}"
        vault_rsv = self._vault_controller.authorize_and_reserve_budget(
            brand_id=brand_id,
            campaign_id=campaign_id,
            requested_usd=daily_budget_usd,
        )

        approval_id = f"hitl_{uuid.uuid4().hex[:10]}"
        proposal = {
            "approval_id": approval_id,
            "campaign_id": campaign_id,
            "brand_id": brand_id,
            "platform": platform,
            "campaign_name": campaign_name,
            "daily_budget_usd": round(float(daily_budget_usd), 2),
            "approved_copy": audit.approved_copy,
            "compliance_status": audit.status,
            "compliance_risk_score": audit.risk_score_after,
            "reservation_id": vault_rsv["reservation_id"],
            "low_balance_alert_20pct": vault_rsv["low_balance_alert_20pct"],
            "remaining_ratio_pct": vault_rsv["remaining_ratio_pct"],
            "hitl_status": "PENDING",
            "status": "DRAFT_PENDING_HITL",
        }
        self._proposals[approval_id] = proposal
        return proposal

    def get_proposal(self, approval_id: str) -> dict:
        if approval_id not in self._proposals:
            raise TraffickerGateError(f"HITL proposal '{approval_id}' not found")
        return self._proposals[approval_id]

    def approve_hitl_and_deploy(self, approval_id: str, decided_by: str = "telegram_operator") -> dict:
        proposal = self.get_proposal(approval_id)
        proposal["hitl_status"] = "APPROVED"
        proposal["decided_by"] = decided_by
        return self.execute_approved_deployment(approval_id)

    def reject_hitl_and_release(self, approval_id: str, decided_by: str = "telegram_operator") -> dict:
        proposal = self.get_proposal(approval_id)
        if proposal["hitl_status"] != "PENDING":
            raise TraffickerGateError(f"Proposal '{approval_id}' already decided ({proposal['hitl_status']})")
        self._treasury.release_rejected_reservation(
            brand_id=proposal["brand_id"],
            reservation_id=proposal["reservation_id"],
        )
        proposal["hitl_status"] = "REJECTED"
        proposal["status"] = "PAUSED_BY_OPERATOR"
        proposal["decided_by"] = decided_by
        return proposal

    def execute_approved_deployment(self, approval_id: str) -> dict:
        proposal = self.get_proposal(approval_id)
        if proposal["hitl_status"] != "APPROVED":
            raise TraffickerGateError(
                f"Cannot deploy campaign '{proposal['campaign_id']}': "
                f"Human-in-the-Loop approval is {proposal['hitl_status']}"
            )
        committed = self._treasury.commit_approved_spend(
            brand_id=proposal["brand_id"],
            reservation_id=proposal["reservation_id"],
            hitl_status="APPROVED",
        )
        proposal["status"] = "ACTIVE"
        proposal["external_ad_id"] = f"ad_{proposal['platform'].lower()}_{proposal['campaign_id']}"
        proposal["committed_spend_usd"] = abs(committed.amount_usd)
        return proposal
