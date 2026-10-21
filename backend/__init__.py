"""CheckMed Flask API package."""

import os

from flask import Flask, jsonify, request


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        FRONTEND_ORIGINS=os.environ.get(
            "CHECKMED_FRONTEND_ORIGINS",
            "http://localhost:8000,http://127.0.0.1:8000",
        ),
    )
    if test_config:
        app.config.update(test_config)

    @app.after_request
    def add_api_cors_headers(response):
        origin = request.headers.get("Origin")
        allowed = {
            item.strip()
            for item in app.config["FRONTEND_ORIGINS"].split(",")
            if item.strip()
        }
        if request.path.startswith("/api/") and origin in allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", service="checkmed-api", version="0.1.0")

    @app.get("/")
    def api_root():
        return jsonify(
            service="CheckMed API",
            health="/api/health",
            message="A interface do protótipo continua no GitHub Pages.",
        )

    return app
