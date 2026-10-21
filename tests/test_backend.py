from backend import create_app


def test_health_endpoint_reports_service():
    client = create_app({"TESTING": True}).test_client()
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json() == {
        "status": "ok",
        "service": "checkmed-api",
        "version": "0.1.0",
    }


def test_cors_allows_only_configured_frontend_origins():
    client = create_app({
        "TESTING": True,
        "FRONTEND_ORIGINS": "https://checkmed.example",
    }).test_client()

    allowed = client.get("/api/health", headers={"Origin": "https://checkmed.example"})
    denied = client.get("/api/health", headers={"Origin": "https://other.example"})

    assert allowed.headers["Access-Control-Allow-Origin"] == "https://checkmed.example"
    assert "Access-Control-Allow-Origin" not in denied.headers

    preflight = client.options("/api/auth/login", headers={
        "Origin": "https://checkmed.example",
        "Access-Control-Request-Method": "POST",
    })
    assert preflight.status_code == 204
    assert preflight.headers["Access-Control-Allow-Methods"] == "GET, POST, PUT, DELETE, OPTIONS"
    assert preflight.headers["Access-Control-Allow-Headers"] == "Content-Type, Authorization"
    assert preflight.headers["Access-Control-Max-Age"] == "600"
    assert preflight.headers["Cache-Control"] == "no-store"
    assert preflight.headers["X-Content-Type-Options"] == "nosniff"
    assert preflight.headers["Referrer-Policy"] == "no-referrer"
