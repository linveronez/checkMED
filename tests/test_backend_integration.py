"""Neon/Postgres integration tests. Set TEST_DATABASE_URL to an isolated test database."""

import os
import uuid

import pytest

from backend import create_app

TEST_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_URL, reason="TEST_DATABASE_URL não configurada; integração com Postgres ignorada")


@pytest.fixture
def account_client():
    if not TEST_URL:
        pytest.skip("TEST_DATABASE_URL não configurada; integração com Postgres ignorada")
    try:
        import psycopg  # noqa: F401
    except ImportError:
        pytest.skip("psycopg não instalado; integração com Postgres ignorada")
    app = create_app({"TESTING": True, "DATABASE_URL": TEST_URL, "TEST_DATABASE_URL": TEST_URL, "SECRET_KEY": "integration-test-secret", "FRONTEND_ORIGINS": "https://checkmed.example", "MAX_PAYLOAD_BYTES": 4096})
    with app.app_context():
        from backend.migrate import main
        main()
    email = f"codex-{uuid.uuid4().hex}@example.test"
    yield app.test_client(), app, email
    with app.app_context():
        from backend.db import connect
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE email_normalized=%s", (email,))


def register(client, email):
    return client.post("/api/auth/register", json={"email": email, "password": "senha-forte-123", "displayName": "Teste", "consent": {"type": "cloud_sync", "policyVersion": "v1"}})


def snapshot():
    return {"meds": [{"id": "m1", "name": "Losartana", "mode": "daily", "stock": 12, "schedule": [{"time": "08:00", "amount": 1}]}], "events": [], "logs": [], "dailyEntries": {}}


def test_registration_login_rate_limit_sessions_and_password_flows(account_client):
    client, app, email = account_client
    no_consent = client.post("/api/auth/register", json={"email": email, "password": "senha-forte-123"})
    assert no_consent.status_code == 422
    created = register(client, email)
    assert created.status_code == 201
    account = created.get_json()
    assert account["accountId"] and account["recoveryCode"]
    duplicate = register(client, email.upper())
    assert duplicate.status_code == 409

    wrong_password = client.post("/api/auth/login", json={"email": email, "password": "senha-incorreta"})
    unknown_email = client.post("/api/auth/login", json={"email": f"missing-{email}", "password": "senha-incorreta"})
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.get_json()["message"] == unknown_email.get_json()["message"]
    for _ in range(4):
        client.post("/api/auth/login", json={"email": email, "password": "senha-incorreta"})
    limited = client.post("/api/auth/login", json={"email": email, "password": "senha-forte-123"})
    assert limited.status_code == 429 and limited.headers.get("Retry-After")

    token = account["token"]
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer invalid"}).status_code == 401
    auth = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=auth).status_code == 200
    from backend.db import connect
    with app.app_context(), connect() as connection, connection.cursor() as cursor:
        cursor.execute("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=%s", (__import__("hashlib").sha256(token.encode()).hexdigest(),))
    expired = client.get("/api/auth/me", headers=auth)
    assert expired.status_code == 401 and expired.get_json()["message"] == "Sua sessão expirou. Entre de novo."

    # Login using a separate source IP avoids the intentionally active throttle bucket.
    login = client.post("/api/auth/login", json={"email": email, "password": "senha-forte-123"}, headers={"X-Forwarded-For": "203.0.113.77"})
    assert login.status_code == 200
    active_token = login.get_json()["token"]
    active = {"Authorization": f"Bearer {active_token}"}
    second_login = client.post("/api/auth/login", json={"email": email, "password": "senha-forte-123"}, headers={"X-Forwarded-For": "203.0.113.78"})
    other_session = {"Authorization": f"Bearer {second_login.get_json()['token']}"}
    changed = client.post("/api/auth/change-password", json={"currentPassword": "senha-forte-123", "newPassword": "senha-nova-456"}, headers=active)
    assert changed.status_code == 200
    assert client.get("/api/auth/me", headers=active).status_code == 200
    assert client.get("/api/auth/me", headers=other_session).status_code == 401
    reset = client.post("/api/auth/reset-with-code", json={"email": email, "recoveryCode": account["recoveryCode"], "newPassword": "senha-final-789"}, headers={"X-Forwarded-For": "203.0.113.88"})
    assert reset.status_code == 200
    new_code = reset.get_json()["recoveryCode"]
    old_code = client.post("/api/auth/reset-with-code", json={"email": email, "recoveryCode": account["recoveryCode"], "newPassword": "senha-final-789"}, headers={"X-Forwarded-For": "203.0.113.89"})
    assert old_code.status_code == 401
    assert client.get("/api/auth/me", headers=active).status_code == 401
    new_login = client.post("/api/auth/login", json={"email": email, "password": "senha-final-789"}, headers={"X-Forwarded-For": "203.0.113.90"})
    assert new_login.status_code == 200
    assert new_code


def test_sync_conflicts_limits_and_account_deletion(account_client):
    client, app, email = account_client
    account = register(client, email).get_json()
    account_id = account["accountId"]
    auth = {"Authorization": f"Bearer {account['token']}"}
    assert client.get("/api/sync", headers=auth).status_code == 404
    first = client.put("/api/sync", headers=auth, json={"baseVersion": 0, "payload": snapshot() | {"localPin": "ignored"}, "deviceId": "test"})
    assert first.status_code == 200 and first.get_json()["version"] == 1
    assert "localPin" not in client.get("/api/sync", headers=auth).get_json()["payload"]
    second = client.put("/api/sync", headers=auth, json={"baseVersion": 1, "payload": snapshot(), "deviceId": "test"})
    assert second.status_code == 200 and second.get_json()["version"] == 2
    conflict = client.put("/api/sync", headers=auth, json={"baseVersion": 1, "payload": snapshot()})
    assert conflict.status_code == 409 and conflict.get_json()["serverVersion"] == 2
    oversized_payload = {"meds": [], "events": [], "logs": [], "name": "x" * 5000}
    oversized = client.put("/api/sync", headers=auth, json={"baseVersion": 2, "payload": oversized_payload})
    assert oversized.status_code == 413
    deleted_snapshot = client.delete("/api/sync", headers=auth)
    assert deleted_snapshot.status_code == 204
    assert client.get("/api/sync", headers=auth).status_code == 404

    assert client.delete("/api/account", headers=auth, json={"password": "errada", "confirm": "EXCLUIR"}).status_code == 401
    assert client.delete("/api/account", headers=auth, json={"password": "senha-forte-123", "confirm": "nao"}).status_code == 422
    removed = client.delete("/api/account", headers=auth, json={"password": "senha-forte-123", "confirm": "EXCLUIR"})
    assert removed.status_code == 204
    from backend.db import connect
    with app.app_context(), connect() as connection, connection.cursor() as cursor:
        for table, column, value in (("users", "id", account_id), ("sessions", "user_id", account_id), ("snapshots", "user_id", account_id), ("consents", "user_id", account_id), ("auth_attempts", "user_id", account_id)):
            cursor.execute(f"SELECT count(*) AS total FROM {table} WHERE {column}=%s", (account_id,))
            assert cursor.fetchone()["total"] == 0, f"{table} permaneceu após exclusão"
