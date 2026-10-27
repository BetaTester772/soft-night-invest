from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time
from threading import Event
from typing import Any

import pytest
from conftest import TEST_DB_URL, Clock
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from test_booth_api import ADMIN, DAY, boot, buy_payload, join

from study_invest.booth import accounts
from study_invest.booth.models import BoothAccount, BoothOrder, BoothRound

pytestmark = pytest.mark.skipif(
    TEST_DB_URL.startswith("sqlite"), reason="requires PostgreSQL row locks"
)


def test_concurrent_buys_cannot_overspend(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)

    def buy(n: int) -> int:
        return client.post(
            "/api/booth/orders",
            json=buy_payload(f"concurrent-buy-{n:03}", quantity=60),
            headers=headers,
        ).status_code

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(buy, range(24)))
    assert results.count(201) == 1
    me = client.get("/api/booth/state", headers=headers).json()["me"]
    assert me["cash"] == 400_000
    assert me["holdings"][0]["quantity"] == 60


def test_concurrent_retries_create_exactly_one_order(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)

    def buy(_: int) -> int:
        response = client.post(
            "/api/booth/orders", json=buy_payload("identical-request"), headers=headers
        )
        assert response.status_code == 201, response.text
        return int(response.json()["order"]["id"])

    with ThreadPoolExecutor(max_workers=12) as pool:
        ids = list(pool.map(buy, range(24)))
    assert len(set(ids)) == 1
    me = client.get("/api/booth/state", headers=headers).json()["me"]
    assert me["cash"] == 980_000
    assert len(me["orders"]) == 1


def test_other_accounts_and_state_do_not_wait_for_an_order(
    client: TestClient, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    boot(client, clock)
    first = join(client, "첫공룡")
    second = join(client, "다른공룡")
    entered, release = Event(), Event()
    original = accounts.place_order

    def held_order(
        s: Session,
        row: BoothRound,
        account: BoothAccount,
        payload: dict[str, Any],
        now: datetime,
    ) -> BoothOrder:
        if payload["request_id"] == "held-first-order":
            entered.set()
            assert release.wait(10), "test did not release the first order"
        return original(s, row, account, payload, now)

    monkeypatch.setattr(accounts, "place_order", held_order)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(
            client.post, "/api/booth/orders", json=buy_payload("held-first-order"), headers=first
        )
        try:
            assert entered.wait(5)
            other = pool.submit(
                client.post,
                "/api/booth/orders",
                json=buy_payload("independent-order"),
                headers=second,
            ).result(timeout=3)
            assert other.status_code == 201, other.text
            state = pool.submit(client.get, "/api/booth/state").result(timeout=3)
            assert state.status_code == 200, state.text
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 201


def test_market_changes_wait_for_in_flight_orders(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as order_session:
        row = accounts.lock_round(order_session, 1, shared=True)
        # A price publication, pause or close needs an exclusive round lock.
        with factory() as market_session:
            market_session.execute(text("SET LOCAL lock_timeout = '100ms'"))
            with pytest.raises(OperationalError):
                accounts.lock_round(market_session, 1)
        assert row.version == 0
    # Once orders finish, the scheduler can publish the next version normally.
    clock.set(DAY, time(16, 0, 30))
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["order"]["price_version"] == 1
