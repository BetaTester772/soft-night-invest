from datetime import timedelta
from fractions import Fraction
from random import Random

import pytest
from conftest import Clock
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_booth_api import ADMIN, boot

from study_invest.booth.domain import initial_prices
from study_invest.booth.market import event_rates, tick
from study_invest.booth.models import BoothEvent, BoothRound, BoothTick
from study_invest.pricing import StockDraw


@pytest.mark.parametrize("number,expected_change", [(1, 7790), (2, 13640), (3, 19480)])
@pytest.mark.parametrize("up", [True, False])
def test_normal_moves_are_halved(
    client: TestClient,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
    number: int,
    expected_change: int,
    up: bool,
) -> None:
    boot(client, clock, *{1: (17, 0), 2: (18, 30), 3: (19, 30)}[number])
    monkeypatch.setattr(
        "study_invest.booth.market.draw_stock_randoms",
        lambda codes, rng: {code: StockDraw(0 if up else 0.99, 1) for code in codes},
    )
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, number)
        assert row is not None
        row.private = dict(row.private, ghosts=[])
        tick(session, row, 1)
        # 40,000 start, 80,000 initial fund buys, 3,000,000 liquidity, 10-won rounding.
        assert row.prices["GUARD"] == 40_000 + (expected_change if up else -expected_change)


@pytest.mark.parametrize("seed,space,other", [(1, 0.10, 0.04), (2, -0.075, -0.15)])
def test_meteor_effects_are_halved(
    client: TestClient,
    clock: Clock,
    seed: int,
    space: float,
    other: float,
) -> None:
    boot(client, clock, 19, 30)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 3)
        assert row is not None
        effects, _ = event_rates(
            session, row, 80, row.opens_at + timedelta(minutes=40), Random(seed)
        )
        assert effects["GUARD"] == Fraction(str(space))
        assert effects["FEED"] == Fraction(str(other))
        session.flush()
        event = session.scalar(select(BoothEvent).where(BoothEvent.kind == "meteor"))
        assert event is not None
        assert event.rates["GUARD"] == space


@pytest.mark.parametrize("number,lo,hi", [(1, 0.025, 0.04), (2, 0.04, 0.075), (3, 0.06, 0.125)])
def test_ghost_effects_stay_in_halved_range(
    client: TestClient,
    clock: Clock,
    number: int,
    lo: float,
    hi: float,
) -> None:
    boot(client, clock, *{1: (17, 0), 2: (18, 30), 3: (19, 30)}[number])
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, number)
        assert row is not None
        row.private = dict(row.private, ghosts=[1])
        for seed in range(10):
            event_rates(session, row, 1, row.opens_at + timedelta(seconds=30), Random(seed))
        session.flush()
        events = list(session.scalars(select(BoothEvent).where(BoothEvent.kind == "ghost")))
        assert len(events) == 10
        assert all(lo <= abs(rate) <= hi for event in events for rate in event.rates.values())


def test_repeated_losses_stop_at_initial_price_floor_and_can_recover(
    client: TestClient,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "study_invest.booth.market.draw_stock_randoms",
        lambda codes, rng: {code: StockDraw(0, 0) for code in codes},
    )
    boot(client, clock, 19, 30)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    floors = {"FEED": 3000, "EGG": 6000, "PANG": 7500, "FOSS": 4500, "GUARD": 12000, "ORBIT": 9000}
    with factory() as session:
        row = session.get(BoothRound, 3)
        assert row is not None
        row.private = dict(
            row.private,
            ghosts=[],
            pending=[
                {
                    "kind": "incident",
                    "headline": "연속 악재",
                    "rates": dict.fromkeys(initial_prices(), -0.5),
                }
                for _ in range(10)
            ],
        )
        for number in range(1, 11):
            tick(session, row, number)
            assert all(price >= floors[code] for code, price in row.prices.items())
        assert row.prices == floors
        record = session.scalar(select(BoothTick).where(BoothTick.number == 10))
        assert record is not None and record.prices == floors
        row.private = dict(
            row.private,
            pending=[
                {
                    "kind": "incident",
                    "headline": "회복 호재",
                    "rates": dict.fromkeys(initial_prices(), 0.5),
                }
            ],
        )
        tick(session, row, 11)
        assert all(price > floors[code] for code, price in row.prices.items())


def test_news_disappears_on_next_tick_but_remains_in_storage(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 1)
        assert row is not None
        row.private = dict(row.private, ghosts=[])
        session.commit()
    assert (
        client.post(
            "/api/booth/admin/news",
            headers=ADMIN,
            json={
                "round_id": 1,
                "headline": "이번 변동 속보",
                "reason": "테스트",
            },
        ).status_code
        == 200
    )
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert [e["headline"] for e in client.get("/api/booth/state").json()["events"]] == [
        "이번 변동 속보"
    ]
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert client.get("/api/booth/state").json()["events"] == []
    with factory() as session:
        assert session.scalar(select(BoothEvent.headline)) == "이번 변동 속보"
