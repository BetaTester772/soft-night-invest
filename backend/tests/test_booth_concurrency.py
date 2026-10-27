from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import TEST_DB_URL, Clock
from fastapi.testclient import TestClient
from test_booth_api import boot, buy_payload, join

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
