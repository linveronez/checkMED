"""Explicit account deletion endpoint."""

from flask import Blueprint, current_app, g, jsonify, request

from .auth import require_user
from .db import connect, db_unavailable
from .security import verify_password

account_bp = Blueprint("account", __name__)


@account_bp.delete("/account")
@require_user
def delete_account():
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    password, confirmation = body.get("password"), body.get("confirm")
    if confirmation != "EXCLUIR":
        return jsonify(error="confirmation_required", message="Digite EXCLUIR para confirmar a exclusão da conta."), 422
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT password_hash FROM users WHERE id=%s", (g.user_id,))
            user = cursor.fetchone()
            if not user or not isinstance(password, str) or len(password) > 128 or not verify_password(password, user["password_hash"]):
                return jsonify(error="invalid_credentials", message="A senha não confere. A conta continua protegida."), 401
            cursor.execute("DELETE FROM users WHERE id=%s", (g.user_id,))
        return "", 204
    except Exception:
        current_app.logger.warning("CheckMed request failed: account deletion")
        return db_unavailable()
