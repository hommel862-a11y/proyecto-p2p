import base64
import hashlib
import hmac
import json
from pathlib import Path
import time
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken


class SecurityViolationError(Exception):
    """Raised when an architectural security or isolation constraint is violated."""


ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".wav", ".mp3"}


def validate_local_inbox_path(
    candidate_path: str,
    allowed_root: Optional[Path] = None,
) -> Path:
    """
    Architectural Constraint #5:
    Strictly restrict local viral-clip file reads to E:\\Agencia_Inbox\\.
    Blocks path traversal (..), symlinks outside the root, and non-media extensions.
    """
    root = (allowed_root or Path(r"E:\Agencia_Inbox")).resolve()
    raw = Path(candidate_path)

    if raw.is_symlink():
        raise SecurityViolationError(f"Symlinks are forbidden in inbox: {candidate_path}")

    try:
        resolved = raw.resolve(strict=True)
    except FileNotFoundError as exc:
        raise SecurityViolationError(f"Inbox file does not exist: {candidate_path}") from exc

    if not resolved.is_relative_to(root):
        raise SecurityViolationError(
            f"Access denied: path '{resolved}' is outside authorized inbox '{root}'"
        )

    if not resolved.is_file():
        raise SecurityViolationError(f"Path is not a regular file: {resolved}")

    if resolved.suffix.lower() not in ALLOWED_VIDEO_EXTENSIONS:
        raise SecurityViolationError(
            f"Unsupported media extension '{resolved.suffix}' in inbox"
        )

    return resolved


class BrandCredentialVault:
    """
    Architectural Constraint #2:
    Per-brand cryptographic credential isolation (Compliance P2P vs Commerce).
    Binds each encrypted token to its owning brand_id so a token encrypted for
    one brand cannot be decrypted or reused by another brand.
    """

    def __init__(self, master_secret: str) -> None:
        digest = hashlib.sha256(master_secret.encode("utf-8")).digest()
        fernet_key = base64.urlsafe_b64encode(digest)
        self._fernet = Fernet(fernet_key)

    def encrypt_for_brand(self, brand_id: str, plaintext_token: str) -> str:
        if not brand_id or not plaintext_token:
            raise ValueError("brand_id and plaintext_token are required")
        envelope = json.dumps(
            {"brand_id": brand_id, "token": plaintext_token},
            separators=(",", ":"),
        ).encode("utf-8")
        return self._fernet.encrypt(envelope).decode("utf-8")

    def decrypt_for_brand(self, expected_brand_id: str, ciphertext: str) -> str:
        try:
            raw = self._fernet.decrypt(ciphertext.encode("utf-8"))
            payload = json.loads(raw.decode("utf-8"))
        except (InvalidToken, ValueError, KeyError) as exc:
            raise SecurityViolationError("Invalid or tampered brand credential token") from exc

        if payload.get("brand_id") != expected_brand_id:
            raise SecurityViolationError(
                f"Brand asset isolation violation: credential belongs to '{payload.get('brand_id')}', "
                f"cannot be accessed by '{expected_brand_id}'"
            )
        return str(payload["token"])


def sign_arm_webhook_payload(payload: bytes, secret: str, timestamp: int) -> str:
    """Generate HMAC-SHA256 signature header for decoupled Agencia <-> ARM webhooks."""
    canonical = f"{timestamp}.".encode("utf-8") + payload
    digest = hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_arm_webhook_signature(
    payload: bytes,
    signature_header: str,
    timestamp: int,
    secret: str,
    max_skew_seconds: int = 300,
    now_epoch: Optional[int] = None,
) -> bool:
    """Constant-time verification of ARM <-> Agencia webhook HMAC-SHA256 + anti-replay window."""
    current = int(now_epoch if now_epoch is not None else time.time())
    if abs(current - int(timestamp)) > max_skew_seconds:
        return False

    expected = sign_arm_webhook_payload(payload, secret=secret, timestamp=timestamp)
    return hmac.compare_digest(expected, signature_header or "")
