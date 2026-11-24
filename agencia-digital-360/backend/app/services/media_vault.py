from pathlib import Path
import re
import uuid
from app.core.security import SecurityViolationError

ALLOWED_CATEGORIES = {"photos", "videos", "voices", "flyers", "renders"}
ALLOWED_EXTENSIONS_BY_CATEGORY = {
    "photos": {".jpg", ".jpeg", ".png", ".webp"},
    "videos": {".mp4", ".mov", ".webm", ".mkv", ".m4v"},
    "voices": {".wav", ".mp3", ".webm", ".ogg", ".m4a"},
    "flyers": {".png", ".jpg", ".webp"},
    "renders": {".mp4", ".webm"},
}


def _safe_slug(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw.strip().lower()).strip("-")
    if not cleaned:
        raise SecurityViolationError("Invalid brand_slug")
    return cleaned


class MediaVaultService:
    """
    Real Media Vault for uploaded product photos, base videos, browser-recorded voices,
    rendered 9:16 videos, flyers, and Google Flow Watch-Folder (`E:\\Agencia_Inbox\\flow_exports\\`).
    """

    def __init__(self, storage_root: Path, inbox_root: Path) -> None:
        self._storage_root = Path(storage_root).resolve()
        self._inbox_root = Path(inbox_root).resolve()
        self._brands_root = self._storage_root / "brands"
        self._brands_root.mkdir(parents=True, exist_ok=True)
        self._flow_exports_dir = self._inbox_root / "flow_exports"
        self._flow_exports_dir.mkdir(parents=True, exist_ok=True)

    def save_uploaded_asset(
        self,
        brand_id: str,
        brand_slug: str,
        category: str,
        original_filename: str,
        content_bytes: bytes,
    ) -> dict:
        if category not in ALLOWED_CATEGORIES:
            raise SecurityViolationError(f"Unsupported media category: {category}")
        safe_brand = _safe_slug(brand_slug)
        ext = Path(original_filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS_BY_CATEGORY[category]:
            raise SecurityViolationError(f"Extension '{ext}' not allowed for category '{category}'")

        stem = re.sub(r"[^a-zA-Z0-9_-]+", "_", Path(original_filename).stem)[:48] or "asset"
        stored_name = f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
        target_dir = self._brands_root / safe_brand / category
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = (target_dir / stored_name).resolve()

        if not target_file.is_relative_to(self._brands_root):
            raise SecurityViolationError("Path traversal blocked in MediaVaultService")

        target_file.write_bytes(content_bytes)
        relative_url = f"/api/v1/media/files/{safe_brand}/{category}/{stored_name}"
        return {
            "brand_id": brand_id,
            "brand_slug": safe_brand,
            "category": category,
            "filename": stored_name,
            "local_path": str(target_file),
            "relative_url": relative_url,
            "size_bytes": len(content_bytes),
        }

    def resolve_served_file(self, brand_slug: str, category: str, filename: str) -> Path:
        if category not in ALLOWED_CATEGORIES:
            raise SecurityViolationError(f"Unsupported category: {category}")
        safe_brand = _safe_slug(brand_slug)
        if "/" in filename or "\\" in filename or ".." in filename:
            raise SecurityViolationError("Invalid filename")
        target = (self._brands_root / safe_brand / category / filename).resolve()
        if not target.is_relative_to(self._brands_root) or not target.is_file():
            raise SecurityViolationError("Requested media file not found")
        return target

    def scan_google_flow_exports(self) -> list[dict]:
        """Scan E:\\Agencia_Inbox\\flow_exports\\ (Read-Only Watch-Folder for Google Flow exports)."""
        items: list[dict] = []
        if self._flow_exports_dir.exists() and self._flow_exports_dir.is_dir():
            for entry in sorted(self._flow_exports_dir.iterdir()):
                if entry.is_file() and not entry.is_symlink() and entry.suffix.lower() in {".mp4", ".mov", ".webm"}:
                    items.append(
                        {
                            "filename": entry.name,
                            "local_path": str(entry.resolve()),
                            "size_mb": round(entry.stat().st_size / (1024 * 1024), 2),
                            "source": "GOOGLE_FLOW_WATCH_FOLDER",
                        }
                    )
        return items
