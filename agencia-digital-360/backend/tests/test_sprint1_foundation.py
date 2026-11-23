import json
from datetime import timezone, timedelta
from pathlib import Path
import pytest
import yaml
from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[2]


class TestSprint1RepositoryStructureAndConfigs:
    def test_repository_files_exist(self):
        expected = [
            ROOT_DIR / "docker-compose.yml",
            ROOT_DIR / ".env.example",
            ROOT_DIR / "database" / "schema.sql",
            ROOT_DIR / "docs" / "arm_webhook_contract.json",
            ROOT_DIR / "backend" / "app" / "main.py",
            ROOT_DIR / "backend" / "app" / "core" / "config.py",
            ROOT_DIR / "backend" / "app" / "core" / "security.py",
            ROOT_DIR / "backend" / "app" / "core" / "models.py",
        ]
        for path in expected:
            assert path.exists(), f"Missing required Sprint 1 file: {path}"

    def test_docker_compose_enforces_concurrency_one_and_cpu_ram_limits(self):
        compose_path = ROOT_DIR / "docker-compose.yml"
        data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
        services = data.get("services", {})
        assert "backend" in services
        assert "redis" in services
        assert "celery-worker-video" in services
        assert "moneyprinterturbo" in services

        # MoneyPrinterTurbo must run in its own isolated container with CPU/RAM limits
        mpt = services["moneyprinterturbo"]
        assert "mem_limit" in mpt or "deploy" in mpt
        assert "cpus" in mpt or "deploy" in mpt

        # Video worker must enforce concurrency = 1 and mount E:\Agencia_Inbox read-only (:ro)
        worker = services["celery-worker-video"]
        cmd = " ".join(worker["command"]) if isinstance(worker["command"], list) else str(worker["command"])
        assert "--concurrency=1" in cmd or "-c 1" in cmd
        volumes = " ".join(worker.get("volumes", []))
        assert ":ro" in volumes and "Agencia_Inbox" in volumes

    def test_database_schema_is_decoupled_and_has_required_tables(self):
        schema_sql = (ROOT_DIR / "database" / "schema.sql").read_text(encoding="utf-8")
        for table in [
            "brands",
            "campaigns",
            "creative_briefs",
            "media_assets",
            "ad_treasury_ledger",
            "hitl_approvals",
            "arm_attribution_events",
        ]:
            assert f"CREATE TABLE IF NOT EXISTS {table}" in schema_sql
        assert "ENABLE ROW LEVEL SECURITY" in schema_sql
        assert "spend_cap_usd" in schema_sql
        assert "alert_threshold_pct" in schema_sql

    def test_arm_webhook_contract_is_valid_json_with_outbound_and_inbound_events(self):
        contract = json.loads((ROOT_DIR / "docs" / "arm_webhook_contract.json").read_text(encoding="utf-8"))
        assert contract["contract_version"] == "1.0.0"
        assert contract["decoupling_policy"]["shared_database_allowed"] is False
        assert "ad_lead_attributed" in contract["webhooks"]["outbound_agencia_to_arm"]["events"]
        assert "closed_won" in contract["webhooks"]["inbound_arm_to_agencia"]["events"]


class TestSprint1CoreConfigAndSecurity:
    def test_vet_timezone_is_utc_minus_4(self):
        from app.core.config import get_settings, now_vet

        settings = get_settings()
        assert settings.timezone_name == "America/Caracas"
        assert settings.utc_offset_hours == -4
        assert settings.video_worker_concurrency == 1
        current = now_vet()
        assert current.utcoffset() == timedelta(hours=-4)

    def test_inbox_path_guard_allows_agencia_inbox_and_blocks_traversal(self, tmp_path):
        from app.core.security import validate_local_inbox_path, SecurityViolationError

        inbox_dir = tmp_path / "Agencia_Inbox"
        inbox_dir.mkdir()
        valid_video = inbox_dir / "clip_test.mp4"
        valid_video.write_bytes(b"\x00\x00\x00\x18ftypmp42")

        resolved = validate_local_inbox_path(str(valid_video), allowed_root=inbox_dir)
        assert resolved == valid_video.resolve()

        outside_file = tmp_path / "secret.txt"
        outside_file.write_text("forbidden", encoding="utf-8")
        with pytest.raises(SecurityViolationError, match="outside authorized inbox"):
            validate_local_inbox_path(str(outside_file), allowed_root=inbox_dir)

        with pytest.raises(SecurityViolationError, match="Unsupported media extension"):
            bad_ext = inbox_dir / "malware.exe"
            bad_ext.write_text("bad", encoding="utf-8")
            validate_local_inbox_path(str(bad_ext), allowed_root=inbox_dir)

    def test_brand_credential_isolation_encryption_and_cross_brand_rejection(self):
        from app.core.security import BrandCredentialVault, SecurityViolationError

        vault = BrandCredentialVault(master_secret="sprint1-master-secret-key-32bytes!!")
        token_brand_a = vault.encrypt_for_brand("brand_p2p_01", "EAA_META_SECRET_TOKEN_P2P")
        token_brand_b = vault.encrypt_for_brand("brand_cashea_02", "EAA_META_SECRET_TOKEN_CASHEA")

        assert token_brand_a != token_brand_b
        assert vault.decrypt_for_brand("brand_p2p_01", token_brand_a) == "EAA_META_SECRET_TOKEN_P2P"

        # Attempting to decrypt P2P credentials under a Commerce brand must fail closed
        with pytest.raises(SecurityViolationError, match="Brand asset isolation violation"):
            vault.decrypt_for_brand("brand_cashea_02", token_brand_a)

    def test_arm_webhook_hmac_signature_verification(self):
        from app.core.security import sign_arm_webhook_payload, verify_arm_webhook_signature

        secret = "arm-bridge-hmac-secret"
        payload = b'{"event":"closed_won","ad_id":"meta_9042","amount_usd":185.0}'
        timestamp = 1795450000
        sig = sign_arm_webhook_payload(payload, secret=secret, timestamp=timestamp)

        assert verify_arm_webhook_signature(
            payload,
            signature_header=sig,
            timestamp=timestamp,
            secret=secret,
            now_epoch=timestamp + 30,
        ) is True

        # Replay attack outside 300s window must fail
        assert verify_arm_webhook_signature(
            payload,
            signature_header=sig,
            timestamp=timestamp,
            secret=secret,
            now_epoch=timestamp + 600,
        ) is False


class TestSprint1FastApiApp:
    def test_health_and_contract_endpoints(self):
        from app.main import app

        client = TestClient(app)
        res = client.get("/api/v1/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["timezone"] == "America/Caracas (VET UTC-04:00)"
        assert body["video_worker_concurrency"] == 1
        assert body["arm_decoupled"] is True
        assert set(body["ai_stack_ve"]) == {"gemini_pro", "openai_chatgpt", "nano_banana"}

        contract_res = client.get("/api/v1/contracts/arm-webhook")
        assert contract_res.status_code == 200
        assert contract_res.json()["contract_version"] == "1.0.0"
