"""Account authentication endpoints."""

from datetime import timedelta
from functools import wraps
import re

from flask import Blueprint, current_app, g, jsonify, request

from .db import connect, db_unavailable
from .security import (clear_failures, hash_password, is_rate_limited,
                       new_recovery_code, new_session_token, rate_key,
                       record_failure, recovery_hash, token_hash,
                       verify_password, verify_recovery_code)

auth_bp = Blueprint("auth", __name__)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
GENERIC_LOGIN = "E-mail ou senha incorretos. Confira os dados e tente novamente."
EXPIRED = "Sua sessão expirou. Entre de novo."


def normalize_email(value):
    if not isinstance(value, str):
        raise ValueError("Informe um e-mail válido.")
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise ValueError("Informe um e-mail válido.")
    return email


def valid_password(password, email):
    return isinstance(password, str) and 8 <= len(password) <= 128 and password.lower() != email


def body_json():
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else {}


def issue_session(cursor, user_id, device_label=""):
    from datetime import datetime, timezone
    token = new_session_token()
    cursor.execute(
        "INSERT INTO sessions (user_id, token_hash, device_label, expires_at, last_used_at) VALUES (%s,%s,%s,%s,%s)",
        (user_id, token_hash(token), (device_label or "")[:100], datetime.now(timezone.utc) + timedelta(days=current_app.config["SESSION_DAYS"]), datetime.now(timezone.utc)),
    )
    return token


def require_user(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not token:
            return jsonify(error="session_expired", message=EXPIRED), 401
        try:
            with connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE sessions SET last_used_at=now() WHERE token_hash=%s AND expires_at>now() RETURNING user_id",
                    (token_hash(token),),
                )
                session = cursor.fetchone()
                if not session:
                    return jsonify(error="session_expired", message=EXPIRED), 401
                g.user_id = session["user_id"]
                g.token_hash = token_hash(token)
        except Exception:
            current_app.logger.warning("CheckMed request failed: session lookup")
            return db_unavailable()
        return fn(*args, **kwargs)
    return wrapped


@auth_bp.post("/auth/register")
def register():
    data = body_json()
    key = rate_key("register", "")
    try:
        with connect() as connection, connection.cursor() as cursor:
            retry = is_rate_limited(cursor, key, "register", 10, 60)
            if retry:
                return _rate_limited(retry)
            registration_attempt_id = record_failure(cursor, key, "register")
    except Exception:
        current_app.logger.warning("CheckMed request failed: registration throttle")
        return db_unavailable()
    try:
        email = normalize_email(data.get("email"))
    except ValueError as exc:
        return jsonify(error="invalid_email", message=str(exc)), 422
    password = data.get("password")
    if not valid_password(password, email):
        return jsonify(error="invalid_password", message="Use uma senha de 8 a 128 caracteres, diferente do e-mail."), 422
    display_name = data.get("displayName", "")
    consent = data.get("consent")
    if not isinstance(display_name, str) or len(display_name) > 40:
        return jsonify(error="invalid_display_name", message="O nome deve ter até 40 caracteres."), 422
    if not isinstance(consent, dict) or consent.get("type") != "cloud_sync" or not isinstance(consent.get("policyVersion"), str) or not consent["policyVersion"].strip():
        return jsonify(error="consent_required", message="Para criar a conta, aceite o consentimento para sincronização na nuvem."), 422
    try:
        with connect() as connection, connection.cursor() as cursor:
            code = new_recovery_code()
            cursor.execute(
                "INSERT INTO users (email,email_normalized,password_hash,recovery_code_hash,recovery_code_expires_at,display_name) VALUES (%s,%s,%s,%s,now() + (%s * interval '1 minute'),%s) ON CONFLICT (email_normalized) DO NOTHING RETURNING id",
                (data["email"].strip(), email, hash_password(password), recovery_hash(code), current_app.config["RECOVERY_CODE_TTL_MINUTES"], display_name.strip()),
            )
            inserted = cursor.fetchone()
            if not inserted:
                return jsonify(error="email_in_use", message="Este e-mail já está cadastrado. Entre na sua conta ou recupere o acesso."), 409
            user_id = inserted["id"]
            cursor.execute("UPDATE auth_attempts SET user_id=%s WHERE id=%s", (user_id, registration_attempt_id))
            cursor.execute("INSERT INTO consents (user_id,type,policy_version) VALUES (%s,'cloud_sync',%s)", (user_id, consent["policyVersion"].strip()[:80]))
            token = issue_session(cursor, user_id, data.get("deviceLabel", ""))
            return jsonify(accountId=str(user_id), email=email, displayName=display_name.strip(), token=token, recoveryCode=code), 201
    except Exception:
        current_app.logger.warning("CheckMed request failed: account registration")
        return db_unavailable()


@auth_bp.post("/auth/login")
def login():
    data = body_json()
    raw_email = data.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) else ""
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        email = (email[:254] or "invalid")
    key = rate_key("login", email)
    try:
        with connect() as connection, connection.cursor() as cursor:
            retry = is_rate_limited(cursor, key, "login", 5, 15)
            if retry:
                return _rate_limited(retry)
            cursor.execute("SELECT id,email,password_hash,display_name FROM users WHERE email_normalized=%s", (email,))
            user = cursor.fetchone()
            candidate = data.get("password") if isinstance(data.get("password"), str) and len(data.get("password")) <= 128 else ""
            # A fixed scrypt hash keeps the missing-account path comparable.
            from .security import _DUMMY_PASSWORD_HASH
            valid = verify_password(candidate, user["password_hash"] if user else _DUMMY_PASSWORD_HASH)
            if not user or not valid:
                record_failure(cursor, key, "login", user["id"] if user else None)
                return jsonify(error="invalid_credentials", message=GENERIC_LOGIN), 401
            clear_failures(cursor, key, "login")
            cursor.execute("UPDATE users SET last_login_at=now() WHERE id=%s", (user["id"],))
            token = issue_session(cursor, user["id"], data.get("deviceLabel", ""))
            return jsonify(accountId=str(user["id"]), email=user["email"], displayName=user["display_name"], token=token), 200
    except Exception:
        current_app.logger.warning("CheckMed request failed: login")
        return db_unavailable()


@auth_bp.post("/auth/logout")
@require_user
def logout():
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM sessions WHERE token_hash=%s", (g.token_hash,))
        return "", 204
    except Exception:
        current_app.logger.warning("CheckMed request failed: logout")
        return db_unavailable()


@auth_bp.get("/auth/me")
@require_user
def me():
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT id,email,display_name,created_at,last_login_at FROM users WHERE id=%s", (g.user_id,))
            user = cursor.fetchone()
        if not user:
            return jsonify(error="session_expired", message=EXPIRED), 401
        return jsonify(accountId=str(user["id"]), email=user["email"], displayName=user["display_name"], createdAt=user["created_at"].isoformat(), lastLoginAt=user["last_login_at"].isoformat() if user["last_login_at"] else None)
    except Exception:
        current_app.logger.warning("CheckMed request failed: account lookup")
        return db_unavailable()


@auth_bp.post("/auth/change-password")
@require_user
def change_password():
    data = body_json()
    old_password, new_password = data.get("currentPassword"), data.get("newPassword")
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT email_normalized,password_hash FROM users WHERE id=%s", (g.user_id,))
            user = cursor.fetchone()
            if not isinstance(old_password, str) or not verify_password(old_password, user["password_hash"]):
                return jsonify(error="invalid_credentials", message="A senha atual não confere."), 401
            if not valid_password(new_password, user["email_normalized"]):
                return jsonify(error="invalid_password", message="Use uma senha de 8 a 128 caracteres, diferente do e-mail."), 422
            cursor.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(new_password), g.user_id))
            cursor.execute("DELETE FROM sessions WHERE user_id=%s AND token_hash<>%s", (g.user_id, g.token_hash))
        return jsonify(message="Senha alterada. Esta sessão continua ativa.")
    except Exception:
        current_app.logger.warning("CheckMed request failed: password change")
        return db_unavailable()


@auth_bp.post("/auth/reset-with-code")
def reset_with_code():
    data = body_json()
    raw_email = data.get("email")
    email = raw_email.strip().lower() if isinstance(raw_email, str) else ""
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        email = email[:254] or "invalid"
    key = rate_key("reset", email)
    try:
        with connect() as connection, connection.cursor() as cursor:
            retry = is_rate_limited(cursor, key, "reset", 5, 15)
            if retry:
                return _rate_limited(retry)
            cursor.execute("SELECT id,recovery_code_hash,recovery_code_expires_at FROM users WHERE email_normalized=%s", (email,))
            user = cursor.fetchone()
            candidate = data.get("recoveryCode", "")
            valid = user and user["recovery_code_expires_at"] and user["recovery_code_expires_at"].timestamp() > __import__("time").time() and isinstance(candidate, str) and verify_recovery_code(candidate, user["recovery_code_hash"])
            if not valid:
                record_failure(cursor, key, "reset", user["id"] if user else None)
                return jsonify(error="invalid_recovery_code", message="E-mail ou código de recuperação incorretos."), 401
            password = data.get("newPassword")
            if not valid_password(password, email):
                return jsonify(error="invalid_password", message="Use uma senha de 8 a 128 caracteres, diferente do e-mail."), 422
            new_code = new_recovery_code()
            cursor.execute("UPDATE users SET password_hash=%s,recovery_code_hash=%s,recovery_code_expires_at=now() + (%s * interval '1 minute') WHERE id=%s", (hash_password(password), recovery_hash(new_code), current_app.config["RECOVERY_CODE_TTL_MINUTES"], user["id"]))
            cursor.execute("DELETE FROM sessions WHERE user_id=%s", (user["id"],))
            clear_failures(cursor, key, "reset")
            return jsonify(message="Senha redefinida. Guarde seu novo código de recuperação em local seguro.", recoveryCode=new_code)
    except Exception:
        current_app.logger.warning("CheckMed request failed: password recovery")
        return db_unavailable()


def _rate_limited(seconds):
    response = jsonify(error="rate_limited", message="Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.")
    response.status_code = 429
    response.headers["Retry-After"] = str(seconds)
    return response
