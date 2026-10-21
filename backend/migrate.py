"""Apply ordered SQL migrations using DATABASE_URL."""

from pathlib import Path

from flask import Flask

from .db import connect


def main():
    app = Flask(__name__)
    import os
    app.config["DATABASE_URL"] = os.environ.get("DATABASE_URL", "")
    if not app.config["DATABASE_URL"]:
        raise SystemExit("Configure DATABASE_URL antes de aplicar as migrations.")
    with app.app_context(), connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
            for path in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
                cursor.execute("SELECT 1 FROM schema_migrations WHERE name=%s", (path.name,))
                if cursor.fetchone():
                    continue
                cursor.execute(path.read_text(encoding="utf-8"))
                cursor.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                print(f"Aplicada: {path.name}")


if __name__ == "__main__":
    main()
