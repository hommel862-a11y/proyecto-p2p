from datetime import datetime, timezone, timedelta
from functools import lru_cache
import os
from pathlib import Path
from pydantic import BaseModel, Field

VET_TIMEZONE = timezone(timedelta(hours=-4), name="VET")


def now_vet() -> datetime:
    """Return the current timestamp in Venezuela Time (VET, UTC-04:00)."""
    return datetime.now(VET_TIMEZONE)


class Settings(BaseModel):
    app_name: str = "Agencia Digital 360 — Execution Module"
    app_version: str = "1.0.0"
    timezone_name: str = "America/Caracas"
    utc_offset_hours: int = -4
    video_worker_concurrency: int = Field(default=1, ge=1, le=1)
    local_inbox_dir: Path = Field(
        default_factory=lambda: Path(os.getenv("LOCAL_INBOX_DIR", r"E:\Agencia_Inbox"))
    )
    storage_dir: Path = Field(
        default_factory=lambda: Path(
            os.getenv(
                "AG360_STORAGE_DIR",
                r"E:\05_Proyectos\proyecto p2p\agencia-digital-360\storage",
            )
        )
    )
    arm_decoupled: bool = True
    arm_webhook_hmac_secret: str = Field(
        default_factory=lambda: os.getenv(
            "ARM_WEBHOOK_HMAC_SECRET", "dev-arm-ag360-shared-secret"
        )
    )
    master_vault_secret: str = Field(
        default_factory=lambda: os.getenv(
            "AG360_MASTER_VAULT_SECRET", "dev-ag360-master-vault-secret-32b!"
        )
    )
    ai_stack_ve: tuple[str, ...] = ("gemini_pro", "openai_chatgpt", "nano_banana")
    moneyprinter_api_url: str = Field(
        default_factory=lambda: os.getenv("MONEYPRINTER_API_URL", "http://localhost:8085")
    )
    moneyprinter_custom_audio_patch: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
