from datetime import date, time

from conftest import ADMIN_KEY, Clock
from fastapi.testclient import TestClient

DAY = date(2026, 10, 30)
ADMIN = {"X-Admin-Key": ADMIN_KEY}


def join(client: TestClient, nickname: str = "김공룡") -> dict[str, str]:
    response = client.post("/api/booth/join", json={"nickname": nickname})
    assert response.status_code == 201, response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def boot(client: TestClient, clock: Clock, hour: int = 16, minute: int = 0) -> None:
    clock.set(DAY, time(hour, minute))
    response = client.post("/api/booth/admin/run", headers=ADMIN)
    assert response.status_code == 200, response.text


def enroll(client: TestClient, headers: dict[str, str], round_id: int = 1) -> None:
    response = client.post("/api/booth/enroll", json={"round_id": round_id}, headers=headers)
    assert response.status_code == 200, response.text


def buy_payload(request_id: str = "test-order-001", **changes: object) -> dict[str, object]:
    return (
        dict(round_id=1, request_id=request_id, kind="stock", code="FEED", side="buy", quantity=2)
        | changes
    )


def test_public_state_and_nickname_only_participation(client: TestClient, clock: Clock) -> None:
    clock.set(DAY, time(15, 59))
    response = client.get("/api/booth/state")
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data["rounds"]) == 3
    assert len(data["instruments"]) == 6
    assert "private" not in str(data)
    assert data["me"] is None
    headers = join(client)
    data = client.get("/api/booth/state", headers=headers).json()
    assert data["me"]["cash"] == 1_000_000
    assert data["me"]["nickname"] == "김공룡"
    assert client.post("/api/booth/join", json={"nickname": "김공룡"}).status_code == 409
    assert client.post("/api/booth/join", json={"nickname": "   "}).status_code == 422


def test_enrollment_is_idempotent_and_tokens_are_required(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    assert client.post("/api/booth/enroll", json={"round_id": 1}).status_code == 401
    headers = join(client)
    enroll(client, headers)
    enroll(client, headers)
    assert client.get("/api/booth/state", headers=headers).json()["me"]["cash"] == 1_000_000
    other = join(client, "다른공룡")
    assert client.get("/api/booth/state", headers=other).json()["me"]["holdings"] == []
    assert client.post("/api/booth/logout", headers=headers).status_code == 204
    assert client.get("/api/booth/state", headers=headers).status_code == 401


def test_order_retries_and_payload_conflicts(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    payload = buy_payload()
    response = client.post("/api/booth/orders", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["me"]["cash"] == 980_000
    duplicate = client.post("/api/booth/orders", json=payload, headers=headers)
    assert duplicate.status_code == 201
    assert duplicate.json()["order"]["id"] == response.json()["order"]["id"]
    assert duplicate.json()["me"]["cash"] == 980_000
    conflict = client.post("/api/booth/orders", json=dict(payload, quantity=3), headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "REQUEST_CONFLICT"


def test_order_limits_closing_and_wrong_session(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    response = client.post("/api/booth/orders", json=buy_payload(quantity=101), headers=headers)
    assert response.status_code == 409
    response = client.post("/api/booth/orders", json=buy_payload(side="sell"), headers=headers)
    assert response.status_code == 409
    response = client.post("/api/booth/orders", json=buy_payload(quantity=True), headers=headers)
    assert response.status_code == 422
    clock.set(DAY, time(16, 50))
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 409
    boot(client, clock, 17)
    response = client.post("/api/booth/orders", json=buy_payload(), headers=headers)
    assert response.status_code == 409
    enroll(client, headers, 2)
    data = client.get("/api/booth/state?round_id=2", headers=headers).json()
    assert data["me"]["cash"] == 1_000_000
    assert data["me"]["holdings"] == []
    assert data["instruments"][0]["price"] == 10_000


def test_fund_purchase_and_redemption_preserve_cash(client: TestClient, clock: Clock) -> None:
    boot(client, clock)
    headers = join(client)
    payload = {
        "round_id": 1,
        "request_id": "fund-subscribe",
        "kind": "fund",
        "code": "HERB",
        "side": "buy",
        "amount": 100_000,
    }
    response = client.post("/api/booth/orders", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    me = response.json()["me"]
    assert me["cash"] == 900_000
    assert me["fund_value"] == 100_000
    assert me["total_assets"] == 1_000_000
    units = me["funds"][0]["units"]
    payload = dict(payload, request_id="fund-redeem", side="sell", amount=None, units=units)
    response = client.post("/api/booth/orders", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json()["me"]["cash"] == 1_000_000
    assert response.json()["me"]["fund_value"] == 0


def test_admin_requires_key_and_recovery_invalidates_old_token(
    client: TestClient,
    clock: Clock,
) -> None:
    boot(client, clock)
    headers = join(client)
    assert client.post("/api/booth/admin/run").status_code == 401
    participant = client.get("/api/booth/state", headers=headers).json()["me"]["participant_id"]
    response = client.post(
        "/api/booth/admin/recover",
        json={"participant_id": participant, "reason": "현장 본인 확인"},
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/booth/state", headers=headers).status_code == 401
    new_headers = {"Authorization": "Bearer " + response.json()["token"]}
    assert client.get("/api/booth/state", headers=new_headers).status_code == 200
