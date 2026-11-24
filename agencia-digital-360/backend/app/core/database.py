import json
from pathlib import Path
import sqlite3
from typing import Any, Optional
import uuid
from app.core.config import now_vet
from app.core.security import BrandCredentialVault


class AgenciaSqliteStore:
    """
    Persistent Zero-Seed SQLite storage residing strictly on E:\\ (Zero-C-Drive bloat).
    Persists brands, encrypted per-brand/global API credentials, uploaded media assets,
    and async production jobs across server restarts.
    """

    def __init__(self, db_path: Path, credential_vault: BrandCredentialVault) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._vault = credential_vault
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS brands (
                    brand_id TEXT PRIMARY KEY,
                    slug TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    industry_vertical TEXT NOT NULL,
                    card_label TEXT DEFAULT '',
                    card_last4 TEXT DEFAULT '',
                    vault_balance_usd REAL NOT NULL DEFAULT 0.0,
                    spend_cap_usd REAL NOT NULL DEFAULT 0.0,
                    accumulated_spend_usd REAL NOT NULL DEFAULT 0.0,
                    reserved_spend_usd REAL NOT NULL DEFAULT 0.0,
                    attributed_revenue_usd REAL NOT NULL DEFAULT 0.0,
                    closed_won_count INTEGER NOT NULL DEFAULT 0,
                    alert_threshold_pct REAL NOT NULL DEFAULT 20.0,
                    created_at_vet TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS api_connections (
                    scope_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    secret_ciphertext TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    last_test_status TEXT NOT NULL DEFAULT 'UNTESTED',
                    last_tested_at TEXT,
                    updated_at_vet TEXT NOT NULL,
                    PRIMARY KEY (scope_id, provider)
                );

                CREATE TABLE IF NOT EXISTS media_assets (
                    asset_id TEXT PRIMARY KEY,
                    brand_id TEXT NOT NULL,
                    brand_slug TEXT NOT NULL,
                    category TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    local_path TEXT NOT NULL,
                    relative_url TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at_vet TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS creative_jobs (
                    job_id TEXT PRIMARY KEY,
                    brand_id TEXT NOT NULL,
                    job_type TEXT NOT NULL,
                    engine TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress_pct INTEGER NOT NULL DEFAULT 0,
                    stage_label TEXT NOT NULL DEFAULT 'QUEUED',
                    output_json TEXT NOT NULL DEFAULT '{}',
                    created_at_vet TEXT NOT NULL
                );
                """
            )

    def create_brand(
        self,
        brand_id: str,
        slug: str,
        display_name: str,
        industry_vertical: str,
        spend_cap_usd: float = 0.0,
        vault_balance_usd: float = 0.0,
        alert_threshold_pct: float = 20.0,
        card_label: str = "",
        card_last4: str = "",
    ) -> dict[str, Any]:
        ts = now_vet().isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO brands (
                    brand_id, slug, display_name, industry_vertical,
                    card_label, card_last4, vault_balance_usd, spend_cap_usd,
                    accumulated_spend_usd, reserved_spend_usd,
                    attributed_revenue_usd, closed_won_count,
                    alert_threshold_pct, created_at_vet
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 0, ?, ?)
                """,
                (
                    brand_id,
                    slug,
                    display_name,
                    industry_vertical,
                    card_label,
                    card_last4,
                    round(float(vault_balance_usd), 2),
                    round(float(spend_cap_usd), 2),
                    round(float(alert_threshold_pct), 2),
                    ts,
                ),
            )
        return self.get_brand(brand_id)  # type: ignore[return-value]

    def get_brand(self, brand_id: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM brands WHERE brand_id = ?", (brand_id,)).fetchone()
            return dict(row) if row else None

    def list_brands(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM brands ORDER BY created_at_vet DESC").fetchall()
            return [dict(r) for r in rows]

    def delete_brand(self, brand_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM brands WHERE brand_id = ?", (brand_id,))
            conn.execute("DELETE FROM api_connections WHERE scope_id = ?", (brand_id,))
            return cur.rowcount > 0

    def update_brand_vault_balance(self, brand_id: str, delta_usd: float, spend_cap_usd: Optional[float] = None) -> dict[str, Any]:
        brand = self.get_brand(brand_id)
        if not brand:
            raise KeyError(f"Brand '{brand_id}' not found")
        new_bal = max(0.0, round(float(brand["vault_balance_usd"]) + float(delta_usd), 2))
        new_cap = round(float(spend_cap_usd), 2) if spend_cap_usd is not None else float(brand["spend_cap_usd"])
        with self._connect() as conn:
            conn.execute(
                "UPDATE brands SET vault_balance_usd = ?, spend_cap_usd = ? WHERE brand_id = ?",
                (new_bal, new_cap, brand_id),
            )
        return self.get_brand(brand_id)  # type: ignore[return-value]

    def save_connection(
        self,
        scope_id: str,
        provider: str,
        secret_token: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        ciphertext = self._vault.encrypt_for_brand(scope_id, secret_token)
        ts = now_vet().isoformat()
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO api_connections (
                    scope_id, provider, secret_ciphertext, metadata_json,
                    last_test_status, last_tested_at, updated_at_vet
                ) VALUES (?, ?, ?, ?, 'SAVED_UNTESTED', NULL, ?)
                ON CONFLICT(scope_id, provider) DO UPDATE SET
                    secret_ciphertext = excluded.secret_ciphertext,
                    metadata_json = excluded.metadata_json,
                    updated_at_vet = excluded.updated_at_vet
                """,
                (scope_id, provider, ciphertext, meta_json, ts),
            )
        return {
            "scope_id": scope_id,
            "provider": provider,
            "configured": True,
            "metadata": metadata or {},
            "last_test_status": "SAVED_UNTESTED",
            "updated_at_vet": ts,
        }

    def update_connection_test_status(self, scope_id: str, provider: str, status: str) -> None:
        ts = now_vet().isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE api_connections SET last_test_status = ?, last_tested_at = ? WHERE scope_id = ? AND provider = ?",
                (status, ts, scope_id, provider),
            )

    def get_raw_ciphertext(self, scope_id: str, provider: str) -> str:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT secret_ciphertext FROM api_connections WHERE scope_id = ? AND provider = ?",
                (scope_id, provider),
            ).fetchone()
            if not row:
                raise KeyError(f"Connection {scope_id}/{provider} not configured")
            return str(row["secret_ciphertext"])

    def get_decrypted_connection(self, scope_id: str, provider: str) -> tuple[str, dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT secret_ciphertext, metadata_json FROM api_connections WHERE scope_id = ? AND provider = ?",
                (scope_id, provider),
            ).fetchone()
            if not row:
                raise KeyError(f"Connection {scope_id}/{provider} not configured")
            plaintext = self._vault.decrypt_for_brand(scope_id, str(row["secret_ciphertext"]))
            return plaintext, json.loads(str(row["metadata_json"]))

    def list_connections_masked(self, scope_id: Optional[str] = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if scope_id:
                rows = conn.execute(
                    "SELECT scope_id, provider, metadata_json, last_test_status, last_tested_at, updated_at_vet FROM api_connections WHERE scope_id = ? OR scope_id = 'GLOBAL'",
                    (scope_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT scope_id, provider, metadata_json, last_test_status, last_tested_at, updated_at_vet FROM api_connections"
                ).fetchall()
            return [
                {
                    "scope_id": r["scope_id"],
                    "provider": r["provider"],
                    "configured": True,
                    "metadata": json.loads(r["metadata_json"]),
                    "last_test_status": r["last_test_status"],
                    "last_tested_at": r["last_tested_at"],
                    "updated_at_vet": r["updated_at_vet"],
                }
                for r in rows
            ]

    def record_media_asset(
        self,
        brand_id: str,
        brand_slug: str,
        category: str,
        filename: str,
        local_path: str,
        relative_url: str,
        size_bytes: int,
    ) -> dict[str, Any]:
        asset_id = f"med_{uuid.uuid4().hex[:10]}"
        ts = now_vet().isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO media_assets (
                    asset_id, brand_id, brand_slug, category, filename,
                    local_path, relative_url, size_bytes, created_at_vet
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (asset_id, brand_id, brand_slug, category, filename, local_path, relative_url, size_bytes, ts),
            )
        return {
            "asset_id": asset_id,
            "brand_id": brand_id,
            "brand_slug": brand_slug,
            "category": category,
            "filename": filename,
            "local_path": local_path,
            "relative_url": relative_url,
            "size_bytes": size_bytes,
            "created_at_vet": ts,
        }

    def list_media_assets(self, brand_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM media_assets WHERE brand_id = ? ORDER BY created_at_vet DESC",
                (brand_id,),
            ).fetchall()
            return [dict(r) for r in rows]
