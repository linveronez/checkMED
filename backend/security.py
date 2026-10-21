"""Password, recovery/session tokens, and database-backed throttling."""

import base64
import hashlib
import hmac
import secrets

from flask import current_app, request


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    enc = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    return f"scrypt$16384$8$1${enc(salt)}${enc(digest)}"


def verify_password(password, encoded):
    try:
        scheme, n, r, p, salt_text, digest_text = encoded.split("$")
        if scheme != "scrypt":
            return False
        dec = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        expected = dec(digest_text)
        actual = hashlib.scrypt(password.encode(), salt=dec(salt_text), n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, MemoryError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def new_session_token():
    return secrets.token_urlsafe(32)


def new_recovery_code():
    raw = base64.b32encode(secrets.token_bytes(13)).decode().rstrip("=")[:20]
    return "-".join(raw[i:i + 4] for i in range(0, 20, 4))


def recovery_hash(code):
    return token_hash(" ".join(code.upper().replace("-", "").split()))


def verify_recovery_code(code, encoded_hash):
    return hmac.compare_digest(recovery_hash(code), encoded_hash)


def client_ip():
    forwarded = request.headers.get("X-Forwarded-For", "")
    return (forwarded.split(",", 1)[0].strip() or request.remote_addr or "unknown")[:128]


def rate_key(kind, email=""):
    material = f"{current_app.config.get('SECRET_KEY', '')}{email}{client_ip()}"
    return hashlib.sha256(material.encode()).hexdigest()


def is_rate_limited(cursor, key, kind, limit, window_minutes):
    cursor.execute("DELETE FROM auth_attempts WHERE created_at < now() - interval '24 hours'")
    cursor.execute(
        "SELECT count(*) AS count, min(created_at) AS oldest FROM auth_attempts WHERE key=%s AND kind=%s AND created_at > now() - (%s * interval '1 minute')",
        (key, kind, window_minutes),
    )
    row = cursor.fetchone()
    if row["count"] < limit:
        return 0
    cursor.execute("SELECT greatest(1, ceil(extract(epoch from (%s + (%s * interval '1 minute') - now()))))::integer AS retry", (row["oldest"], window_minutes))
    return cursor.fetchone()["retry"]


def record_failure(cursor, key, kind, user_id=None):
    cursor.execute("INSERT INTO auth_attempts (key, kind, user_id) VALUES (%s,%s,%s) RETURNING id", (key, kind, user_id))
    return cursor.fetchone()["id"]


def clear_failures(cursor, key, kind):
    cursor.execute("DELETE FROM auth_attempts WHERE key=%s AND kind=%s", (key, kind))


_DUMMY_PASSWORD_HASH = hash_password("checkmed-timing-only-password")
