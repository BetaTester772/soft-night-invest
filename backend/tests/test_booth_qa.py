from dataclasses import replace
from datetime import date, time
from typing import Any

import pytest
from conftest import ADMIN_KEY, Clock, kst
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_booth_api import buy_payload, join

from study_invest.api.app import create_app
from study_invest.booth.models import (
    BoothAccount,
    BoothCashGrant,
    BoothEvent,
    BoothOrder,
    BoothResult,
)
from study_invest.clock import OffsetClock
from study_invest.config import Settings

ADMIN = {"X-Admin-Key": ADMIN_KEY}


def test_qa_clock_can_step_and_move_to_next_session() -> None:
    clock = Clock(kst(date(2026, 10, 30), time(16, 59, 50)))
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
        assert response.json()["round_id"] == 1
        assert client.get("/api/booth/state").json()["round"]["state"] == "open"
        response = client.post("/api/booth/admin/qa/step", json={"seconds": 30}, headers=ADMIN)
        assert response.status_code == 200, response.text
        assert client.get("/api/booth/state").json()["round"]["version"] == 1
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200
        assert client.get("/api/booth/state").json()["round"]["id"] == 2


def test_qa_routes_are_disabled_on_normal_servers(client: TestClient) -> None:
    assert client.post("/api/booth/admin/qa/next", headers=ADMIN).status_code == 404
    assert (
        client.post("/api/booth/admin/qa/close", headers=ADMIN, json={"round_id": 1}).status_code
        == 404
    )


def test_qa_next_uses_stored_schedule_after_manual_opening() -> None:
    clock = Clock(kst(date(2026, 10, 29), time(14)))
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
        opened = client.post(
            "/api/booth/admin/open", json={"round_id": 1, "reason": "현장 개장"}, headers=ADMIN
        )
        assert opened.status_code == 200, opened.text
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200, response.text
        current = client.get("/api/booth/state").json()["round"]
        assert current["id"] == 2
        assert current["is_open"] is True


@pytest.fixture
def qa_state(client: TestClient, clock: Clock) -> Any:
    state = client.app.state.study_invest  # type: ignore[attr-defined]
    state.settings = replace(state.settings, event_mode="booth", qa_tools=True)
    state.clock = OffsetClock(clock)
    clock.set(date(2026, 10, 30), time(16, 59))
    return state


@pytest.mark.parametrize(
    "start,run_scheduler",
    [
        (time(16, 59), False),
        (time(16, 59), True),
        (time(21), False),
        (time(21), True),
        (time(17), False),
    ],
)
def test_qa_rounds_cycle_repeatedly_even_after_event_end(
    client: TestClient, clock: Clock, qa_state: Any, start: time, run_scheduler: bool
) -> None:
    clock.set(date(2026, 10, 30), start)
    if run_scheduler:
        client.post("/api/booth/admin/run", headers=ADMIN).raise_for_status()
    for expected in (1, 2, 3, 1, 2, 3, 1):
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200, response.text
        assert response.json()["round_id"] == expected
        data = client.get("/api/booth/state").json()
        assert data["round"]["id"] == expected
        assert data["round"]["is_open"] is True
        assert sum(r["is_open"] for r in data["rounds"]) == 1
        assert (
            client.post("/api/booth/admin/qa/step", json={"seconds": 30}, headers=ADMIN).status_code
            == 200
        )
        assert client.get("/api/booth/state").json()["round"]["version"] == 1


def test_qa_cycle_clears_financial_records_but_keeps_login(
    client: TestClient, qa_state: Any
) -> None:
    client.post("/api/booth/admin/qa/next", headers=ADMIN)
    assert client.post("/api/booth/admin/qa/next").status_code == 401
    headers = join(client)
    person_id = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    client.post("/api/booth/orders", json=buy_payload(), headers=headers).raise_for_status()
    client.post(
        "/api/booth/orders",
        json=buy_payload("fund-buy", kind="fund", code="HERB", quantity=None, amount=100000),
        headers=headers,
    ).raise_for_status()
    client.post(
        "/api/booth/admin/grant",
        headers=ADMIN,
        json={
            "round_id": 1,
            "participant_id": person_id,
            "amount": 250000,
            "reason": "QA",
            "request_id": "qa-grant",
        },
    ).raise_for_status()
    client.post(
        "/api/booth/admin/qa/cash",
        headers=ADMIN,
        json={
            "round_id": 1,
            "participant_id": person_id,
            "amount": 1000,
            "reason": "QA",
        },
    ).raise_for_status()
    for _ in range(3):
        response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
        assert response.status_code == 200, response.text
    response = client.get("/api/booth/state", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["me"]["participant_id"] == person_id
    assert data["me"]["cash"] == data["me"]["principal"] == 1000000
    assert data["me"]["holdings"] == []
    assert data["ranking"][0]["eligible"] is False
    assert data["ranking"][0]["return_rate"] == 0
    with qa_state.session_factory() as s:
        assert list(s.scalars(select(BoothCashGrant))) == []
        assert list(s.scalars(select(BoothResult))) == []
        assert list(s.scalars(select(BoothEvent))) == []
        account = s.scalar(select(BoothAccount).where(BoothAccount.participant_id == person_id))
        assert account is not None
        assert account.funds == {}
        assert account.qa_cash == 0
        assert account.first_trade_at is None
        assert list(s.scalars(select(BoothOrder).where(BoothOrder.account_id == account.id))) == []
    # Reusing a previous request ID executes a fresh order in the new cycle.
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["me"]["cash"] == 980000


@pytest.mark.parametrize("paused", [False, True])
def test_qa_close_freezes_current_prices_and_results(
    client: TestClient, qa_state: Any, paused: bool
) -> None:
    client.post("/api/booth/admin/qa/next", headers=ADMIN).raise_for_status()
    headers = join(client)
    client.post("/api/booth/orders", json=buy_payload(), headers=headers).raise_for_status()
    client.post("/api/booth/admin/qa/step", json={"seconds": 30}, headers=ADMIN).raise_for_status()
    if paused:
        client.post(
            "/api/booth/admin/control",
            headers=ADMIN,
            json={
                "round_id": 1,
                "action": "pause",
                "reason": "QA",
            },
        ).raise_for_status()
    before = client.get("/api/booth/state?round_id=1", headers=headers).json()
    now = qa_state.clock()
    for _ in range(2):
        response = client.post("/api/booth/admin/qa/close", headers=ADMIN, json={"round_id": 1})
        assert response.status_code == 200, response.text
    after = client.get("/api/booth/state?round_id=1", headers=headers).json()
    assert after["round"]["state"] == "closed"
    assert after["round"]["is_open"] is False
    assert after["round"]["paused_reason"] is None
    assert after["round"]["version"] == before["round"]["version"]
    assert after["instruments"] == before["instruments"]
    assert after["me"]["total_assets"] == before["me"]["total_assets"]
    assert qa_state.clock() == now
    assert after["rounds"][1]["state"] == "pending"
    with qa_state.session_factory() as s:
        results = list(s.scalars(select(BoothResult).where(BoothResult.round_id == 1)))
        assert len(results) == 1
        assert results[0].confirmed is False
        assert results[0].entries[0]["total_assets"] == before["me"]["total_assets"]
    assert (
        client.post(
            "/api/booth/orders", json=buy_payload("after-qa-close"), headers=headers
        ).status_code
        == 409
    )
    response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["round_id"] == 2


def test_qa_close_rejects_unopened_round_and_requires_admin(
    client: TestClient, qa_state: Any
) -> None:
    client.get("/api/booth/state").raise_for_status()
    assert client.post("/api/booth/admin/qa/close", json={"round_id": 1}).status_code == 401
    response = client.post("/api/booth/admin/qa/close", headers=ADMIN, json={"round_id": 1})
    assert response.status_code == 409
    assert client.get("/api/booth/state?round_id=1").json()["round"]["state"] == "pending"


def test_qa_close_last_round_still_allows_restart(client: TestClient, qa_state: Any) -> None:
    for _ in range(3):
        client.post("/api/booth/admin/qa/next", headers=ADMIN).raise_for_status()
    client.post("/api/booth/admin/qa/close", headers=ADMIN, json={"round_id": 3}).raise_for_status()
    client.post("/api/booth/admin/run", headers=ADMIN).raise_for_status()
    assert client.get("/api/booth/state?round_id=3").json()["round"]["state"] == "closed"
    response = client.post("/api/booth/admin/qa/next", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.json()["round_id"] == 1
    assert client.get("/api/booth/state").json()["round"]["is_open"] is True
