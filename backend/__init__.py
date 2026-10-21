"""CheckMed Flask API package."""

import os

from flask import Flask, jsonify, request, Response


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", ""),
        DATABASE_URL=os.environ.get("DATABASE_URL", ""),
        TEST_DATABASE_URL=os.environ.get("TEST_DATABASE_URL", ""),
        FRONTEND_ORIGINS=os.environ.get(
            "CHECKMED_FRONTEND_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000",
        ),
        SESSION_DAYS=int(os.environ.get("SESSION_DAYS", "30")),
        MAX_PAYLOAD_BYTES=int(os.environ.get("MAX_PAYLOAD_BYTES", str(1024 * 1024))),
        RECOVERY_CODE_TTL_MINUTES=int(os.environ.get("RECOVERY_CODE_TTL_MINUTES", "30")),
        MAX_CONTENT_LENGTH=int(os.environ.get("MAX_PAYLOAD_BYTES", str(1024 * 1024))) + 65536,
    )
    if test_config:
        app.config.update(test_config)

    @app.before_request
    def empty_api_preflight():
        if request.path.startswith("/api/") and request.method == "OPTIONS":
            return Response(status=204)

    @app.after_request
    def add_security_and_cors_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            origin = request.headers.get("Origin")
            allowed = {
                item.strip()
                for item in app.config["FRONTEND_ORIGINS"].split(",")
                if item.strip()
            }
            if origin in allowed:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
                response.headers["Access-Control-Max-Age"] = "600"
        return response

    @app.errorhandler(413)
    def payload_too_large(_error):
        return jsonify(error="payload_too_large", message="O arquivo enviado é maior que o permitido."), 413

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", service="checkmed-api", version="0.1.0")

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith("/api/"):
            return jsonify(error="not_found", message="Este endereço da API não foi encontrado."), 404
        return error

    @app.errorhandler(405)
    def method_not_allowed(error):
        if request.path.startswith("/api/"):
            return jsonify(error="method_not_allowed", message="Este método não está disponível neste endereço."), 405
        return error

    @app.errorhandler(500)
    def internal_error(error):
        if request.path.startswith("/api/"):
            app.logger.warning("CheckMed request failed: internal API error")
            return jsonify(error="service_unavailable", message="Não foi possível concluir agora. Tente novamente em instantes."), 500
        return error

    @app.get("/")
    def api_root():
        return jsonify(
            service="CheckMed API",
            health="/api/health",
            message="A interface do protótipo continua no GitHub Pages.",
        )

    from .auth import auth_bp
    from .sync import sync_bp

    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(sync_bp, url_prefix="/api")
    return app
