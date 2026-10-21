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
