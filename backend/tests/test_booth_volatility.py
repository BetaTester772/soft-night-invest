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
        (1, 17, 0, 0.0, 1.0, 29_840),
        (1, 17, 0, 0.9, 1.0, 20_160),
        (2, 18, 30, 0.0, 1.0, 33_470),
        (2, 18, 30, 0.9, 1.0, 16_530),
        (3, 19, 30, 0.0, 1.0, 37_100),
        (3, 19, 30, 0.9, 1.0, 12_900),
        (1, 17, 0, 0.0, 0.1, 25_050),
        (1, 17, 0, 0.9, 0.1, 24_950),
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


def test_booth_halves_random_moves_and_incident_rates_before_combining(
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
    assert stock["price"] == 32_820
    assert state["events"][0]["rates"] == {"PANG": 0.1, "FOSS": 0.1}
