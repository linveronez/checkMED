"""Small per-request PostgreSQL connection helpers (no ORM)."""

from contextlib import contextmanager
import time

from flask import current_app


@contextmanager
def connect(*, test=False):
    url = current_app.config.get("TEST_DATABASE_URL") if test else ""
    url = url or current_app.config.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("Banco de dados não configurado")
    import psycopg
    from psycopg.rows import dict_row

    connection = None
    for attempt in range(2):
        try:
            connection = psycopg.connect(url, connect_timeout=10, row_factory=dict_row)
            break
        except psycopg.OperationalError:
            if attempt:
                raise
            time.sleep(0.25)
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
