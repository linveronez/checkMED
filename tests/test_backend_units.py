import re

import pytest

from backend import create_app
from backend.auth import normalize_email, valid_password
from backend.payload import PayloadError, validate_payload
from backend.security import (hash_password, new_recovery_code, new_session_token,
                              recovery_hash, verify_password, verify_recovery_code)


def sample_payload():
    return {"meds": [{"id": "m1", "name": "Losartana", "mode": "daily", "strength": "50mg", "perDose": 1, "stock": 10, "schedule": [{"time": "08:30", "amount": 1}]}], "events": [{"id": "e1", "title": "Consulta", "date": "2026-10-22", "time": "10:00"}], "logs": [{"id": "l1", "medName": "Losartana", "date": "2026-10-21", "time": "08:30", "status": "taken", "amount": 1}]}


def test_email_and_password_validation():
    assert normalize_email("  LINCE@Example.com ") == "lince@example.com"
    assert valid_password("senha-forte", "lince@example.com")
    assert not valid_password("curta", "lince@example.com")
    assert not valid_password("lince@example.com", "lince@example.com")
    with pytest.raises(ValueError):
        normalize_email("inválido")


def test_recovery_and_session_tokens_have_expected_shape():
    code = new_recovery_code()
    assert re.fullmatch(r"[A-Z2-7]{4}(?:-[A-Z2-7]{4}){4}", code)
    assert verify_recovery_code(code.lower(), recovery_hash(code))
    assert not verify_recovery_code(new_recovery_code(), recovery_hash(code))
    assert len(new_session_token()) >= 40


def test_scrypt_password_hash_and_verification():
    stored = hash_password("senha segura")
    assert stored.startswith("scrypt$")
    assert verify_password("senha segura", stored)
    assert not verify_password("outra senha", stored)


def test_payload_accepts_and_whitelists_compatible_snapshot():
    payload = sample_payload() | {"unknown": "never stored", "name": "Lince", "hideMedicationNameInNotification": False}
    result = validate_payload(payload)
    assert "unknown" not in result
    assert result["meds"][0]["times"] == ["08:30"]
    assert result["hideMedicationNameInNotification"] is False


@pytest.mark.parametrize("mutate", [
    lambda p: p.update(meds="not a list"),
    lambda p: p["events"][0].update(date="2026-02-30"),
    lambda p: p["events"][0].update(time="25:90"),
    lambda p: p["logs"][0].update(status="unknown"),
    lambda p: p["meds"][0]["schedule"][0].update(amount=0),
])
def test_payload_rejects_malformed_values(mutate):
    import copy
    payload = copy.deepcopy(sample_payload())
    mutate(payload)
    with pytest.raises(PayloadError):
        validate_payload(payload)


def test_api_cors_security_headers_and_preflight():
    client = create_app({"TESTING": True, "FRONTEND_ORIGINS": "https://checkmed.example"}).test_client()
    preflight = client.options("/api/auth/login", headers={"Origin": "https://checkmed.example", "Access-Control-Request-Method": "POST"})
    assert preflight.status_code == 204
    assert preflight.headers["Access-Control-Allow-Methods"] == "GET, POST, PUT, DELETE, OPTIONS"
    assert preflight.headers["Access-Control-Max-Age"] == "600"
    assert preflight.headers["Cache-Control"] == "no-store"
    assert preflight.headers["X-Content-Type-Options"] == "nosniff"
    assert preflight.headers["Referrer-Policy"] == "no-referrer"
    denied = client.get("/api/health", headers={"Origin": "https://other.example"})
    assert "Access-Control-Allow-Origin" not in denied.headers

