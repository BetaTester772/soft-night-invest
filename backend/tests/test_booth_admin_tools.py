from datetime import date, datetime, time, timedelta
from typing import cast

import pytest
from conftest import Clock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_booth_api import ADMIN, DAY, boot, buy_payload, join

from study_invest.booth import accounts
from study_invest.booth.models import BoothRound
from study_invest.models import AuditLog


def open_now(client: TestClient, round_id: int = 1) -> None:
    response = client.post(
        "/api/booth/admin/open",
        json={"round_id": round_id, "reason": "현장 개장"},
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text


def test_open_now_uses_real_time_for_join_orders_ticks_and_closing(
    client: TestClient, clock: Clock
) -> None:
    clock.set(date(2026, 10, 29), time(14))
    # A participant may already have enrolled before the operator opens the market.
    existing = join(client)
    open_now(client)
    snapshot = client.get("/api/booth/state", headers=existing).json()
    row = snapshot["round"]
    assert row["is_open"] is True
    assert datetime.fromisoformat(row["opens_at"]) == clock()
    assert datetime.fromisoformat(row["closes_at"]) == clock() + timedelta(minutes=50)
    assert snapshot["me"]["cash"] == 1_000_000
    later = join(client, "현장 참가자")
    assert client.post("/api/booth/orders", json=buy_payload(), headers=later).status_code == 201
    clock.now += timedelta(seconds=30)
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert client.get("/api/booth/state").json()["round"]["version"] == 1
    for action in ("pause", "resume"):
        assert (
            client.post(
                "/api/booth/admin/control",
                json={"round_id": 1, "action": action, "reason": "현장 운영"},
                headers=ADMIN,
            ).status_code
            == 200
        )
    clock.now += timedelta(minutes=50)
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert client.get("/api/booth/state?round_id=1").json()["round"]["state"] == "closed"
    assert (
        client.post("/api/booth/orders", json=buy_payload("after-close"), headers=later).status_code
        == 409
    )


@pytest.mark.parametrize("day", [DAY, date(2026, 10, 31)])
def test_manual_open_after_original_event_end_allows_join(
    client: TestClient, clock: Clock, day: date
) -> None:
    clock.set(day, time(21))
    open_now(client, 3)
    headers = join(client)
    data = client.get("/api/booth/state", headers=headers).json()
    assert data["round"]["id"] == 3
    assert data["me"]["enrolled"] is True
    clock.now += timedelta(minutes=50)
    response = client.post("/api/auth/email-code", json={"email": "afterclose@g.skku.edu"})
    assert response.status_code == 409


def test_open_now_cannot_reset_or_overlap_another_round(client: TestClient, clock: Clock) -> None:
    clock.set(DAY, time(15, 30))
    open_now(client)
    before = client.get("/api/booth/state?round_id=1").json()["round"]
    assert (
        client.post(
            "/api/booth/admin/open", json={"round_id": 1, "reason": "다시"}, headers=ADMIN
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/booth/admin/open", json={"round_id": 2, "reason": "동시 개장"}, headers=ADMIN
        ).status_code
        == 409
    )
    assert client.get("/api/booth/state?round_id=1").json()["round"] == before
    clock.set(DAY, time(16, 30))
    # A 50-minute window here would overlap the pending second round at 17:00.
    assert (
        client.post(
            "/api/booth/admin/open", json={"round_id": 3, "reason": "시간 중복"}, headers=ADMIN
        ).status_code
        == 409
    )


def grant_body(participant_id: int, **changes: object) -> dict[str, object]:
    return (
        dict(
            round_id=1,
            participant_id=participant_id,
            amount=250_000,
            reason="현장 지원금",
            request_id="grant-test-001",
        )
        | changes
    )


def test_cash_grant_is_idempotent_and_excluded_from_returns(
    client: TestClient, clock: Clock
) -> None:
    boot(client, clock)
    headers = join(client)
    other = join(client, "다른 참가자")
    me = client.get("/api/booth/state", headers=headers).json()["me"]
    body = grant_body(me["participant_id"])
    assert client.post("/api/booth/orders", json=buy_payload(), headers=headers).status_code == 201
    for _ in range(2):
        response = client.post("/api/booth/admin/grant", json=body, headers=ADMIN)
        assert response.status_code == 200, response.text
        assert response.json()["cash"] == 1_230_000
    data = client.get("/api/booth/state", headers=headers).json()
    assert data["me"]["return_rate"] == 0
    assert data["me"]["holdings"][0]["quantity"] == 2
    assert data["me"]["total_assets"] == 1_250_000
    assert (
        next(r for r in data["ranking"] if r["participant_id"] == me["participant_id"])[
            "return_rate"
        ]
        == 0
    )
    assert client.get("/api/booth/state", headers=other).json()["me"]["cash"] == 1_000_000
    conflict = client.post("/api/booth/admin/grant", json=dict(body, amount=500_000), headers=ADMIN)
    assert conflict.status_code == 409
    status = client.get("/api/booth/admin/status", headers=ADMIN).json()
    assert (
        next(p for p in status["participants"] if p["participant_id"] == me["participant_id"])[
            "cash"
        ]
        == 1_230_000
    )


@pytest.mark.parametrize("amount", [0, -1, 1.5, True, 1_000_000_001])
def test_cash_grant_rejects_invalid_amount(
    client: TestClient, clock: Clock, amount: object
) -> None:
    boot(client, clock)
    headers = join(client)
    participant = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    assert (
        client.post(
            "/api/booth/admin/grant", json=grant_body(participant, amount=amount), headers=ADMIN
        ).status_code
        == 422
    )


def test_cash_grants_require_authorization_valid_account_and_reason(
    client: TestClient, clock: Clock
) -> None:
    boot(client, clock)
    headers = join(client)
    participant = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    body = grant_body(participant)
    for path, payload in (("open", {"round_id": 2, "reason": "개장"}), ("grant", body)):
        assert client.post("/api/booth/admin/" + path, json=payload).status_code == 401
        assert (
            client.post("/api/booth/admin/" + path, json=payload, headers=headers).status_code
            == 401
        )
        assert (
            client.post(
                "/api/booth/admin/" + path, json=dict(payload, reason="  "), headers=ADMIN
            ).status_code
            == 422
        )
    assert (
        client.post("/api/booth/admin/grant", json=grant_body(999), headers=ADMIN).status_code
        == 404
    )
    assert (
        client.post(
            "/api/booth/admin/grant", json=dict(body, round_id=2), headers=ADMIN
        ).status_code
        == 404
    )
    client.post(
        "/api/booth/admin/disqualify",
        json={"round_id": 1, "participant_id": participant, "reason": "중복 참가"},
        headers=ADMIN,
    )
    assert client.post("/api/booth/admin/grant", json=body, headers=ADMIN).status_code == 409


def test_cash_grant_cannot_change_closed_results(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    participant = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    clock.set(DAY, time(16, 50))
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert (
        client.post(
            "/api/booth/admin/grant", json=grant_body(participant), headers=ADMIN
        ).status_code
        == 409
    )


def test_ranking_compares_investment_returns_after_grants(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    recipient = join(client, "지원금 참가자")
    investor = join(client, "일반 참가자")
    pid = client.get("/api/booth/state", headers=recipient).json()["me"]["participant_id"]
    body = grant_body(pid)
    assert client.post("/api/booth/admin/grant", json=body, headers=ADMIN).status_code == 200
    assert client.post("/api/booth/admin/grant", json=body, headers=ADMIN).status_code == 200
    for headers in (recipient, investor):
        assert (
            client.post(
                "/api/booth/orders", json=buy_payload(quantity=10), headers=headers
            ).status_code
            == 201
        )
    with cast(FastAPI, client.app).state.study_invest.session_factory() as s:
        row = s.get(BoothRound, 1)
        assert row is not None
        row.prices = dict(row.prices, FEED=11_000)
        s.commit()
        grants = list(s.scalars(select(AuditLog).where(AuditLog.action == "booth.cash.grant")))
        assert len(grants) == 1
        assert grants[0].detail["reason"] == "현장 지원금"
        assert grants[0].detail["amount"] == 250_000
    data = client.get("/api/booth/state", headers=recipient).json()
    assert data["me"]["principal"] == 1_250_000
    assert data["me"]["return_rate"] == 0.008
    assert data["ranking"][0]["nickname"] == "일반 참가자"
    assert data["ranking"][0]["return_rate"] == 0.01
    clock.set(DAY, time(16, 50))
    client.post("/api/booth/admin/run", headers=ADMIN)
    result = client.get("/api/booth/state?round_id=1").json()["result"]
    assert result["entries"][0]["nickname"] == "일반 참가자"
    assert result["entries"][1]["return_rate"] == 0.008


def test_default_selection_follows_stored_round_times(client: TestClient, clock: Clock) -> None:
    clock.set(date(2026, 10, 31), time(14))
    open_now(client, 1)
    clock.now += timedelta(minutes=50)
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert client.get("/api/booth/state").json()["round"]["id"] == 1


def test_cash_grant_principal_is_an_exact_integer(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    participant_id = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    for index, amount in enumerate((250_000, 125_001)):
        response = client.post(
            "/api/booth/admin/grant",
            json=grant_body(participant_id, amount=amount, request_id=f"principal-grant-{index}"),
            headers=ADMIN,
        )
        assert response.status_code == 200, response.text
    with cast(FastAPI, client.app).state.study_invest.session_factory() as s:
        row = accounts.lock_round(s, 1)
        account = accounts.get_account(s, 1, participant_id)
        assert account is not None
        principal = accounts.principals(s, row)[account.id]
        assert isinstance(principal, int)
        assert principal == 1_375_001
