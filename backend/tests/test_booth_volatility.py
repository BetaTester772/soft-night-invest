from datetime import timedelta

import pytest
from conftest import Clock
from fastapi.testclient import TestClient
from test_booth_api import ADMIN, boot

from study_invest.pricing import StockDraw


@pytest.mark.parametrize(
    ("round_id", "hour", "minute", "direction", "magnitude", "expected"),
    [
        # The opening model-fund purchase is 100,000 won, so flow scales the cap by 30/31.
        (1, 17, 0, 0.0, 1.0, 34_680),
        (1, 17, 0, 0.9, 1.0, 15_320),
        (2, 18, 30, 0.0, 1.0, 41_940),
        (2, 18, 30, 0.9, 1.0, 8_060),
        (3, 19, 30, 0.0, 1.0, 49_190),
        (3, 19, 30, 0.9, 1.0, 1_000),
        (1, 17, 0, 0.0, 0.1, 25_100),
        (1, 17, 0, 0.9, 0.1, 24_900),
    ],
)
def test_booth_scales_random_price_moves_before_rounding_and_price_floor(
    client: TestClient,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
    round_id: int,
    hour: int,
    minute: int,
    direction: float,
    magnitude: float,
    expected: int,
) -> None:
    monkeypatch.setattr(
        "study_invest.booth.market.draw_stock_randoms",
        lambda codes, rng: {code: StockDraw(direction, magnitude) for code in codes},
    )
    boot(client, clock, hour, minute)
    clock.now += timedelta(seconds=30)
    response = client.post("/api/booth/admin/run", headers=ADMIN)
    assert response.status_code == 200, response.text
    state = client.get(f"/api/booth/state?round_id={round_id}").json()
    stock = next(i for i in state["instruments"] if i["code"] == "PANG")
    assert stock["previous_price"] == 25_000
    assert stock["price"] == expected
    assert stock["change_rate"] == (expected - 25_000) / 25_000


def test_booth_scales_only_random_moves_before_applying_incident_rates(
    client: TestClient, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "study_invest.booth.market.draw_stock_randoms",
        lambda codes, rng: {code: StockDraw(0.0, 1.0) for code in codes},
    )
    boot(client, clock)
    response = client.post(
        "/api/booth/admin/incident",
        json={
            "round_id": 1,
            "sector": "build",
            "rate": 0.2,
            "headline": "판게아 대륙 분리",
            "reason": "변동폭 확인",
        },
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state").json()
    stock = next(i for i in state["instruments"] if i["code"] == "PANG")
    assert stock["price"] == 41_610
    assert state["events"][0]["rates"] == {"PANG": 0.2, "FOSS": 0.2}
