from datetime import timedelta

from conftest import Clock
from fastapi.testclient import TestClient
from test_booth_api import ADMIN, boot


def test_automatic_market_news_is_varied_and_retry_safe(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    for _ in range(24):
        clock.now += timedelta(seconds=30)
        client.post("/api/booth/admin/run", headers=ADMIN)
    events = client.get("/api/booth/state").json()["events"]
    news = [e for e in events if e["kind"] == "market"]
    assert len(news) >= 2
    assert len({e["headline"] for e in news}) >= 2
    assert all(e["rates"] == {} and e["sector"] in ("feed", "build", "space") for e in news)
    client.post("/api/booth/admin/run", headers=ADMIN)
    assert client.get("/api/booth/state").json()["events"] == events


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
