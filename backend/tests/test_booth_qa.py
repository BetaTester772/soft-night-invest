from datetime import date, time

from conftest import ADMIN_KEY, Clock, kst
from fastapi.testclient import TestClient

from study_invest.api.app import create_app
from study_invest.config import Settings

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def test_qa_clock_can_step_and_move_to_next_session() -> None:
    clock = Clock(kst(date(2026, 10, 30), time(15, 59, 50)))
    app = create_app(
        Settings(
            database_url="sqlite://",
            auto_create_schema=True,
            event_mode="booth",
            qa_tools=True,
            admin_key=ADMIN_KEY,
            cpu_workers=0,
        ),
        clock=clock,
    )
    with TestClient(app) as client:
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200, response.text
        assert client.get("/api/booth/state").json()["round"]["state"] == "open"
        response = client.post("/api/booth/admin/qa/step", json={"seconds": 10}, headers=ADMIN)
        assert response.status_code == 200, response.text
        assert client.get("/api/booth/state").json()["round"]["version"] == 1
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200
        assert client.get("/api/booth/state").json()["round"]["id"] == 2


def test_qa_routes_are_disabled_on_normal_servers(client: TestClient) -> None:
    assert client.post("/api/booth/admin/qa/next", headers=ADMIN).status_code == 404
