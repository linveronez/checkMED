"""Versioned user snapshot endpoints."""

import json

from flask import Blueprint, current_app, g, jsonify, request

from .auth import require_user
from .db import connect, db_unavailable
from .payload import PayloadError, validate_payload

sync_bp = Blueprint("sync", __name__)


@sync_bp.route("/sync", methods=["GET"])
@require_user
def get_snapshot():
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("SELECT version,payload,payload_schema,device_id,updated_at FROM snapshots WHERE user_id=%s", (g.user_id,))
            snapshot = cursor.fetchone()
        if not snapshot:
            return jsonify(error="snapshot_not_found", message="Ainda não há dados sincronizados nesta conta."), 404
        return jsonify(version=snapshot["version"], payload=snapshot["payload"], payloadSchema=snapshot["payload_schema"], deviceId=snapshot["device_id"], updatedAt=snapshot["updated_at"].isoformat())
    except Exception:
        current_app.logger.warning("CheckMed request failed: snapshot read")
        return db_unavailable()


@sync_bp.put("/sync")
@require_user
def put_snapshot():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="invalid_request", message="Envie os dados da sincronização em JSON válido."), 400
    base_version = body.get("baseVersion")
    if isinstance(base_version, bool) or not isinstance(base_version, int) or base_version < 0:
        return jsonify(error="invalid_version", message="A versão de origem da sincronização está inválida."), 422
    try:
        payload = validate_payload(body.get("payload"))
    except PayloadError as exc:
        return jsonify(error="invalid_payload", message=str(exc)), 422
    payload_encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(payload_encoded.encode("utf-8")) > current_app.config["MAX_PAYLOAD_BYTES"]:
        return jsonify(error="payload_too_large", message="Os dados excedem o tamanho máximo permitido para sincronização."), 413
    device_id = body.get("deviceId", "")
    if not isinstance(device_id, str) or len(device_id) > 128:
        return jsonify(error="invalid_device", message="O identificador deste aparelho está inválido."), 422
    try:
        from psycopg.types.json import Jsonb
        with connect() as connection, connection.cursor() as cursor:
            if base_version == 0:
                cursor.execute("INSERT INTO snapshots (user_id,version,payload,payload_schema,device_id) VALUES (%s,1,%s,1,%s) ON CONFLICT (user_id) DO NOTHING RETURNING version", (g.user_id, Jsonb(payload), device_id))
            else:
                cursor.execute("UPDATE snapshots SET version=version+1,payload=%s,payload_schema=1,device_id=%s,updated_at=now() WHERE user_id=%s AND version=%s RETURNING version", (Jsonb(payload), device_id, g.user_id, base_version))
            updated = cursor.fetchone()
            if not updated:
                cursor.execute("SELECT version FROM snapshots WHERE user_id=%s", (g.user_id,))
                server = cursor.fetchone()
                return jsonify(error="sync_conflict", message="Os dados desta conta mudaram em outro aparelho. Atualize e escolha como continuar.", serverVersion=server["version"] if server else 0), 409
        return jsonify(version=updated["version"]), 200
    except Exception:
        current_app.logger.warning("CheckMed request failed: snapshot write")
        return db_unavailable()


@sync_bp.delete("/sync")
@require_user
def delete_snapshot():
    try:
        with connect() as connection, connection.cursor() as cursor:
            cursor.execute("DELETE FROM snapshots WHERE user_id=%s", (g.user_id,))
        return "", 204
    except Exception:
        current_app.logger.warning("CheckMed request failed: snapshot deletion")
        return db_unavailable()


