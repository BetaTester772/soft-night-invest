from datetime import timedelta
from typing import Any

import pytest
from conftest import Clock
from fastapi.testclient import TestClient
from test_booth_api import ADMIN, boot

from study_invest.booth.models import BoothEvent, BoothRound


def test_automatic_market_news_is_varied_and_retry_safe(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 1)
        assert row is not None
        row.private = dict(row.private, ghosts=[])
        session.commit()
    news: list[dict[str, Any]] = []
    for _ in range(24):
        clock.now += timedelta(seconds=30)
        client.post("/api/booth/admin/run", headers=ADMIN)
        news.extend(
            e for e in client.get("/api/booth/state").json()["events"] if e["kind"] == "market"
        )
    events = client.get("/api/booth/state").json()["events"]
    assert len(news) >= 2
    assert len({e["headline"] for e in news}) >= 2
    assert all(e["rates"] == {} and e["sector"] in ("feed", "build", "space") for e in news)
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert client.get("/api/booth/state").json()["events"] == events
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert client.get("/api/booth/state").json()["events"] == []
    history = client.get("/api/booth/state").json()["event_history"]
    assert [e["id"] for e in history if e["kind"] == "market"] == [
        e["id"] for e in reversed(news)
    ]
    assert client.get("/api/booth/state").json()["event_history"] == history
    assert client.get("/api/booth/state?round_id=2").json()["event_history"] == []


def test_history_keeps_older_events_but_never_unpublished_events(
    client: TestClient, clock: Clock
) -> None:
    boot(client, clock)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 1)
        assert row is not None
        for number in range(36):
            session.add(BoothEvent(
                round_id=1, tick=row.version if number < 35 else row.version + 1,
                kind="news", headline=f"공지 {number}", sector=None, rates={},
                created_at=clock.now,
            ))
        session.commit()
    data = client.get("/api/booth/state").json()
    assert [e["headline"] for e in data["event_history"]] == [
        f"공지 {number}" for number in reversed(range(35))
    ]
    assert len({e["id"] for e in data["event_history"]}) == 35


def test_news_tracks_actual_sector_direction_and_rotates_templates() -> None:
    from study_invest.booth.domain import SECTORS, initial_prices
    from study_invest.booth.news import market_headline

    previous = initial_prices()
    for edition, sector in enumerate(SECTORS, 1):
        for delta, words in [
            (100, ("상승", "오름세")),
            (-100, ("하락", "내림세")),
            (0, ("보합", "제자리")),
        ]:
            current = dict(previous)
            current.update({c: previous[c] + delta for c in SECTORS[sector]["codes"]})
            first_sector, first = market_headline(previous, current, edition)
            _, second = market_headline(previous, current, edition + 3)
            assert first_sector == sector
            assert any(word in first for word in words)
            assert first != second


@pytest.mark.parametrize(
    ("kind", "round_id", "event_tick"),
    [("ghost", 1, 4), ("meteor", 3, 80), ("news", 1, 4), ("incident", 1, 4)],
)
def test_scheduled_commentary_cannot_hide_simultaneous_alerts(
    client: TestClient, clock: Clock, kind: str, round_id: int, event_tick: int
) -> None:
    boot(client, clock, 19 if round_id == 3 else 17, 30 if round_id == 3 else 0)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        row = s.get(BoothRound, round_id)
        assert row is not None
        row.private = dict(row.private, ghosts=[event_tick] if kind == "ghost" else [])
        s.commit()
    for _ in range(1, event_tick):
        clock.now += timedelta(seconds=30)
        assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    if kind in ("news", "incident"):
        payload: dict[str, object] = {
            "round_id": round_id,
            "headline": "중요 운영 공지",
            "reason": "test",
        }
        if kind == "incident":
            payload.update(sector="build", rate=0.2)
        assert (
            client.post("/api/booth/admin/" + kind, json=payload, headers=ADMIN).status_code == 200
        )
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    events = client.get(f"/api/booth/state?round_id={round_id}").json()["events"]
    assert events[0]["kind"] == ("manual" if kind == "incident" else kind)
    assert not any(
        e["kind"] == "market" and e["created_at"] == events[0]["created_at"] for e in events
    )
    for _ in range(4):
        clock.now += timedelta(seconds=30)
        assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    assert (
        client.get(f"/api/booth/state?round_id={round_id}").json()["events"][0]["kind"] == "market"
    )
