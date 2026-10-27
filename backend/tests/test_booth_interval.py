from datetime import datetime, timedelta
from itertools import pairwise

from conftest import Clock
from fastapi.testclient import TestClient
from test_booth_api import ADMIN, boot

from study_invest.booth.domain import TICK_SECONDS
from study_invest.booth.market import ghost_schedule
from study_invest.booth.models import BoothRound


def test_prices_update_every_thirty_seconds_without_pausing(
    client: TestClient,
    clock: Clock,
) -> None:
    assert TICK_SECONDS == 30
    boot(client, clock)
    opened = clock.now
    clock.now = opened + timedelta(seconds=29)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert client.get("/api/booth/state").json()["round"]["version"] == 0
    clock.now = opened + timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state").json()
    assert state["round"]["version"] == 1
    assert state["round"]["state"] == "open"
    assert state["round"]["update_interval_seconds"] == 30
    assert state["funds"][0]["last_decision_at"].endswith("16:00:30+09:00")


def test_fifty_minute_session_finishes_after_one_hundred_updates(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    opened = clock.now
    for number in range(1, 101):
        clock.now = opened + timedelta(seconds=30 * number)
        response = client.post("/api/booth/admin/run", headers=ADMIN)
        assert response.status_code == 200, response.text
    state = client.get("/api/booth/state?round_id=1").json()
    assert state["round"]["version"] == 100
    assert state["round"]["state"] == "closed"
    assert len(state["instruments"][0]["history"]) == 101
    assert datetime.fromisoformat(state["instruments"][0]["history"][-1]["x"]).minute == 50


def test_ghost_schedule_keeps_real_time_windows_with_thirty_second_updates() -> None:
    for era in (1, 2, 3):
        ticks = ghost_schedule("thirty-second-cadence", era)
        assert all(60 <= tick * 30 < 2970 for tick in ticks)
        assert all((b - a) * 30 >= 90 for a, b in pairwise(ticks))
        assert 80 not in ticks


def test_meteor_still_occurs_at_twenty_ten(client: TestClient, clock: Clock) -> None:
    boot(client, clock, 19, 30)
    clock.now = clock.now.replace(hour=20, minute=9, second=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    response = client.post(
        "/api/booth/admin/control",
        headers=ADMIN,
        json={"round_id": 3, "action": "resume", "reason": "test"},
    )
    assert response.status_code == 200, response.text
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state?round_id=3").json()
    assert state["round"]["version"] == 80
    meteor = [e for e in state["events"] if e["kind"] == "meteor"]
    assert len(meteor) == 1
    assert meteor[0]["created_at"].endswith("20:10:00+09:00")


def test_already_open_legacy_session_retains_its_stored_tick_meaning(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 1)
        assert row is not None
        config = dict(row.private)
        config.pop("tick_seconds")
        config["ghosts"] = ghost_schedule(config["seed"], 1, 10)
        row.private = config
        session.commit()
    clock.now += timedelta(seconds=10)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state").json()
    assert state["round"]["version"] == 1
    assert state["round"]["update_interval_seconds"] == 10
    assert state["instruments"][0]["history"][-1]["x"].endswith("16:00:10+09:00")
