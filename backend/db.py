"""Small per-request PostgreSQL connection helpers (no ORM)."""

from contextlib import contextmanager

from flask import current_app


@contextmanager
def connect(*, test=False):
    url = current_app.config.get("TEST_DATABASE_URL") if test else ""
    url = url or current_app.config.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("Banco de dados não configurado")
    import psycopg
    from psycopg.rows import dict_row

    connection = psycopg.connect(url, connect_timeout=10, row_factory=dict_row)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def db_unavailable():
    from flask import jsonify

    return jsonify(error="service_unavailable", message="Não foi possível acessar seus dados agora. Tente novamente em instantes."), 503
