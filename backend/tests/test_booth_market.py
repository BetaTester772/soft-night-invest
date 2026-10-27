from datetime import time

from conftest import Clock
from fastapi.testclient import TestClient
from test_booth_api import ADMIN, DAY, boot, buy_payload, join


def run(client: TestClient, clock: Clock, minute: int, second: int = 0) -> None:
    clock.set(DAY, time(16, minute, second))
    response = client.post("/api/booth/admin/run", headers=ADMIN)
    assert response.status_code == 200, response.text


def control(client: TestClient, action: str, round_id: int = 1) -> None:
    response = client.post(
        "/api/booth/admin/control",
        json={"round_id": round_id, "action": action, "reason": "운영 확인"},
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text


def test_ticks_are_idempotent_and_funds_rebalance_every_thirty_seconds(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    for second in (10, 20, 30):
        run(client, clock, 0, second)
    state = client.get("/api/booth/state").json()
    assert state["round"]["version"] == 1
    assert len(state["instruments"][0]["history"]) == 2
    assert state["funds"][0]["last_decision_at"].endswith("00:30+09:00")
    assert "현금" in state["funds"][1]["reason"]
    run(client, clock, 0, 30)
    assert client.get("/api/booth/state").json() == state


def test_long_delay_pauses_then_resume_skips_elapsed_intervals(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    headers = join(client)
    run(client, clock, 1, 30)
    state = client.get("/api/booth/state", headers=headers).json()
    assert state["round"]["state"] == "paused"
    assert state["round"]["version"] == 0
    assert client.post("/api/booth/orders", json=buy_payload(), headers=headers).status_code == 409
    control(client, "resume")
    state = client.get("/api/booth/state", headers=headers).json()
    assert state["round"]["version"] == 3
    assert state["instruments"][0]["price"] == 10_000
    run(client, clock, 2, 0)
    assert client.get("/api/booth/state").json()["round"]["version"] == 4


def test_order_rejects_stale_prices_even_if_scheduler_is_stopped(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    headers = join(client)
    clock.set(DAY, time(16, 1, 30))
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "STALE_PRICE"


def test_sector_incident_changes_only_target_sector(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    response = client.post(
        "/api/booth/admin/incident",
        json={
            "round_id": 1,
            "sector": "build",
            "rate": 0.2,
            "headline": "판게아 대륙 분리",
            "reason": "연출",
        },
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    run(client, clock, 0, 30)
    state = client.get("/api/booth/state").json()
    event = state["events"][0]
    assert event["headline"] == "판게아 대륙 분리"
    assert set(event["rates"]) == {"PANG", "FOSS"}
    prices = {i["code"]: i["price"] for i in state["instruments"]}
    assert prices["PANG"] >= 29_800
    assert prices["FOSS"] >= 17_800
    assert prices["FEED"] < 10_100


def test_final_results_freeze_and_disqualification_creates_revision(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    headers = join(client, "첫공룡")
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 201
    pid = response.json()["me"]["participant_id"]
    clock.set(DAY, time(16, 50))
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state?round_id=1", headers=headers).json()
    assert state["round"]["state"] == "closed"
    assert state["result"]["revision"] == 1
    assert state["result"]["entries"][0]["eligible"]
    assert not state["result"]["confirmed"]
    response = client.post(
        "/api/booth/admin/confirm", json={"round_id": 1, "revision": 1}, headers=ADMIN
    )
    assert response.status_code == 200
    frozen = client.get("/api/booth/state?round_id=1").json()["result"]
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert client.get("/api/booth/state?round_id=1").json()["result"] == frozen
    response = client.post(
        "/api/booth/admin/disqualify",
        json={"round_id": 1, "participant_id": pid, "reason": "중복 참가"},
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    state = client.get("/api/booth/state?round_id=1").json()
    assert state["result"]["revision"] == 2
    assert state["result"]["entries"] == []
    assert not state["result"]["confirmed"]


def test_meteor_is_published_once_after_resume(client: TestClient, clock: Clock) -> None:
    boot(client, clock, 19, 30)
    clock.set(DAY, time(20, 10))
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    control(client, "resume", 3)
    clock.set(DAY, time(20, 10, 30))
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state?round_id=3").json()
    assert len([e for e in state["events"] if e["kind"] == "meteor"]) == 1
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state?round_id=3").json()
    assert len([e for e in state["events"] if e["kind"] == "meteor"]) == 1
