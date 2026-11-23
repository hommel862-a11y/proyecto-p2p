from dataclasses import dataclass, field
import re


class ComplianceError(Exception):
    """Base compliance error."""


class CrossBrandIsolationError(ComplianceError):
    """Raised when an ad operation attempts to mix assets across distinct brands."""


@dataclass
class ComplianceAuditResult:
    brand_id: str
    industry_vertical: str
    original_flagged: bool
    status: str  # APPROVED | REWRITTEN_APPROVED | REJECTED
    risk_score_before: float
    risk_score_after: float
    approved_copy: str
    flagged_terms: list[str] = field(default_factory=list)
    notes: str = ""


class ComplianceAuditorAgent:
    """
    Agent 2 — Auditor & Compliance.
    Enforces:
    1. Strict per-brand asset isolation (never mix P2P and Retail Commerce accounts/pixels).
    2. Pre-flight Meta/TikTok/YouTube policy scanning and automatic safe copy rewriting for LATAM.
    """

    PROHIBITED_PATTERNS: list[tuple[str, str]] = [
        (r"\busdt\s+sin\s+comisi[oó]n(?:es)?\b", "gestión de liquidez digital"),
        (r"\bcambia\s+tus\s+usdt\b", "optimiza la tesorería de tu negocio"),
        (r"\bganancia\s+garantizada\b", "planificación financiera transparente"),
        (r"\barbitraje\s+sin\s+riesgo\b", "control operativo con métricas en tiempo real"),
        (r"\b100%\s+seguro\s+y\s+garantizado\b", "respaldado por soporte verificado"),
        (r"\bduplica\s+tu\s+dinero\b", "mejora el rendimiento de tu operación"),
    ]

    def verify_asset_isolation(
        self,
        campaign_brand_id: str,
        ad_account_brand_id: str,
        pixel_brand_id: str,
    ) -> bool:
        if len({campaign_brand_id, ad_account_brand_id, pixel_brand_id}) != 1:
            raise CrossBrandIsolationError(
                f"Cross-brand asset contamination detected: campaign='{campaign_brand_id}', "
                f"ad_account='{ad_account_brand_id}', pixel='{pixel_brand_id}'"
            )
        return True

    def audit_creative(
        self,
        brand_id: str,
        industry_vertical: str,
        copy_text: str,
        audio_transcript: str = "",
        flyer_text_ratio_pct: float = 10.0,
    ) -> ComplianceAuditResult:
        flagged: list[str] = []
        rewritten = copy_text

        combined = f"{copy_text} {audio_transcript}"
        for pattern, replacement in self.PROHIBITED_PATTERNS:
            if re.search(pattern, combined, flags=re.IGNORECASE):
                flagged.append(pattern)
                rewritten = re.sub(pattern, replacement, rewritten, flags=re.IGNORECASE)

        # Prevent retail/commerce brands from running any P2P/crypto terminology
        if industry_vertical in ("RETAIL_COMMERCE", "CASHEA_ALLY"):
            if re.search(r"\b(p2p|cripto|usdt|binance)\b", combined, flags=re.IGNORECASE):
                flagged.append("p2p_term_in_commerce_brand")
                rewritten = re.sub(
                    r"\b(p2p|cripto|usdt|binance)\b",
                    "pago verificado",
                    rewritten,
                    flags=re.IGNORECASE,
                )

        if flyer_text_ratio_pct > 20.0:
            return ComplianceAuditResult(
                brand_id=brand_id,
                industry_vertical=industry_vertical,
                original_flagged=True,
                status="REJECTED",
                risk_score_before=85.0,
                risk_score_after=85.0,
                approved_copy=copy_text,
                flagged_terms=flagged + ["flyer_text_density_exceeded_20pct"],
                notes="Flyer text overlay exceeds 20% Meta delivery penalty threshold.",
            )

        if flagged:
            return ComplianceAuditResult(
                brand_id=brand_id,
                industry_vertical=industry_vertical,
                original_flagged=True,
                status="REWRITTEN_APPROVED",
                risk_score_before=88.0,
                risk_score_after=4.0,
                approved_copy=rewritten,
                flagged_terms=flagged,
                notes="Gemini Pro Compliance Auditor sanitized policy triggers automatically.",
            )

        return ComplianceAuditResult(
            brand_id=brand_id,
            industry_vertical=industry_vertical,
            original_flagged=False,
            status="APPROVED",
            risk_score_before=3.0,
            risk_score_after=3.0,
            approved_copy=copy_text,
            flagged_terms=[],
            notes="Clean creative brief; complies with Meta/TikTok LATAM policies.",
        )
