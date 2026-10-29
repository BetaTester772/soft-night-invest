from datetime import date, time

from conftest import ADMIN_KEY, Clock, FakeMailer
from fastapi.testclient import TestClient

DAY = date(2026, 10, 30)
ADMIN = {"X-Admin-Key": ADMIN_KEY}


def join(client: TestClient, nickname: str = "김공룡") -> dict[str, str]:
    import hashlib
    from dataclasses import replace

    from conftest import register_with

    state = client.app.state.study_invest  # type: ignore[attr-defined]
    state.settings = replace(state.settings, event_mode="booth")
    email = hashlib.sha256(nickname.encode()).hexdigest()[:12] + "@g.skku.edu"
    response = register_with(client, email, nickname)
    assert response.status_code == 201, response.text
    identity = {"Authorization": "Bearer " + response.json()["token"]}
    response = client.post("/api/booth/session", headers=identity)
    assert response.status_code == 200, response.text
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


def test_public_state_and_registered_participation(client: TestClient, clock: Clock) -> None:
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
    assert client.post("/api/booth/join", json={"nickname": "김공룡"}).status_code == 404
    assert client.post("/api/booth/session").status_code == 401


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


def test_existing_login_reopens_same_booth_account(client: TestClient, clock: Clock) -> None:
    from conftest import register

    study_headers = register(client)
    clock.set(DAY, time(15, 59))
    assert client.post("/api/booth/session").status_code == 401
    first = client.post("/api/booth/session", headers=study_headers)
    assert first.status_code == 200, first.text
    headers = {"Authorization": "Bearer " + first.json()["token"]}
    original = client.get("/api/booth/state", headers=headers).json()["me"]
    assert original["cash"] == 1_000_000
    assert client.post("/api/booth/logout", headers=headers).status_code == 204
    second = client.post("/api/booth/session", headers=study_headers)
    headers = {"Authorization": "Bearer " + second.json()["token"]}
    reopened = client.get("/api/booth/state", headers=headers).json()["me"]
    assert reopened["participant_id"] == original["participant_id"]
    assert reopened["cash"] == original["cash"]


def test_qa_cash_requires_admin_and_qa_and_excludes_ranking(
    client: TestClient, clock: Clock
) -> None:
    from dataclasses import replace

    boot(client, clock)
    headers = join(client)
    person = client.get("/api/booth/state", headers=headers).json()["me"]
    body = dict(round_id=1, participant_id=person["participant_id"], amount=1_000_000, reason="QA")
    url = "/api/booth/admin/qa/cash"
    assert client.post(url, json=body).status_code == 401
    assert client.post(url, json=body, headers=ADMIN).status_code == 404
    app_state = client.app.state.study_invest  # type: ignore[attr-defined]
    app_state.settings = replace(app_state.settings, qa_tools=True)
    assert client.post(url, json=dict(body, amount=-1), headers=ADMIN).status_code == 422
    assert client.post(url, json=body, headers=ADMIN).status_code == 200
    state = client.get("/api/booth/state", headers=headers).json()
    assert state["me"]["cash"] == 2_000_000
    assert state["ranking"] == []
    assert client.post(url, json=dict(body, amount=100_000_000), headers=ADMIN).status_code == 409
    clock.set(DAY, time(16, 50))
    assert client.post(url, json=body, headers=ADMIN).status_code == 409


def test_linked_login_skips_all_occupied_fallback_nicknames(
    client: TestClient, clock: Clock
) -> None:
    from conftest import register

    study_headers = register(client)
    person_id = client.get("/api/me", headers=study_headers).json()["id"]
    clock.set(DAY, time(15, 59))
    occupied = ["alice", f"alice·계정{person_id}", f"alice·계정{person_id}-1"]
    old_ids = []
    from study_invest.booth import accounts

    state = client.app.state.study_invest  # type: ignore[attr-defined]
    for name in occupied:
        with state.session_factory() as session:
            person, _ = accounts.register(session, name, clock(), DAY)
            old_ids.append(person.id)
            session.commit()
    response = client.post("/api/booth/session", headers=study_headers)
    assert response.status_code == 200, response.text
    headers = {"Authorization": "Bearer " + response.json()["token"]}
    account = client.get("/api/booth/state", headers=headers).json()["me"]
    assert account["nickname"] == f"alice·계정{person_id}-2"
    assert account["participant_id"] not in old_ids
    response = client.post("/api/booth/session", headers=study_headers)
    headers = {"Authorization": "Bearer " + response.json()["token"]}
    assert client.get("/api/booth/state", headers=headers).json()["me"] == account


def test_password_reset_revokes_all_linked_booth_tokens(
    client: TestClient, clock: Clock, mailer: FakeMailer
) -> None:
    from conftest import register

    study_headers = register(client)
    clock.set(DAY, time(16, 0))
    other_headers = join(client, "unrelated")
    old_headers = []
    for _ in range(2):
        response = client.post("/api/booth/session", headers=study_headers)
        assert response.status_code == 200, response.text
        old_headers.append({"Authorization": "Bearer " + response.json()["token"]})
    old_account = client.get("/api/booth/state", headers=old_headers[0]).json()["me"]
    response = client.post("/api/auth/password-reset/code", json={"identity": "alice@g.skku.edu"})
    assert response.status_code == 202, response.text
    response = client.post(
        "/api/auth/password-reset",
        json={
            "identity": "alice@g.skku.edu",
            "code": mailer.last_code("alice@g.skku.edu"),
            "password": "amber-lake-sunset-19",
        },
    )
    assert response.status_code == 200, response.text
    for headers in old_headers:
        assert client.get("/api/booth/state", headers=headers).status_code == 401
        assert (
            client.post("/api/booth/orders", json=buy_payload(), headers=headers).status_code == 401
        )
    assert client.post("/api/booth/session", headers=study_headers).status_code == 401
    assert client.get("/api/booth/state", headers=other_headers).status_code == 200
    new_identity = {"Authorization": "Bearer " + response.json()["token"]}
    linked = client.post("/api/booth/session", headers=new_identity)
    assert linked.status_code == 200, linked.text
    new_headers = {"Authorization": "Bearer " + linked.json()["token"]}
    new_account = client.get("/api/booth/state", headers=new_headers).json()["me"]
    assert new_account == old_account


def test_booth_signup_uses_booth_date_and_requires_registration(
    client: TestClient, clock: Clock
) -> None:
    from dataclasses import replace

    from conftest import register_with

    from study_invest.booth import accounts

    state = client.app.state.study_invest  # type: ignore[attr-defined]
    state.settings = replace(state.settings, event_mode="booth")
    clock.set(DAY, time(15, 59))
    assert client.post("/api/booth/join", json={"nickname": "우회"}).status_code == 404
    assert client.post("/api/booth/session").status_code == 401
    with state.session_factory() as session:
        _, legacy_token = accounts.register(session, "예전참가자", clock(), DAY)
        session.commit()
    legacy = {"Authorization": "Bearer " + legacy_token}
    assert client.get("/api/booth/state", headers=legacy).status_code == 401
    assert client.post("/api/booth/enroll", json={"round_id": 1}, headers=legacy).status_code == 401
    response = register_with(client, "newmember@g.skku.edu", "새회원")
    assert response.status_code == 201, response.text
    identity = {"Authorization": "Bearer " + response.json()["token"]}
    linked = client.post("/api/booth/session", headers=identity)
    assert linked.status_code == 200, linked.text
    headers = {"Authorization": "Bearer " + linked.json()["token"]}
    assert client.get("/api/booth/state", headers=headers).json()["me"]["cash"] == 1_000_000
    clock.set(DAY, time(20, 20))
    response = client.post(
        "/api/auth/register",
        json={
            "email": "late@g.skku.edu",
            "nickname": "늦은회원",
            "password": "tiger-moon-river-42",
            "name": "홍길동",
            "student_id": "2026000123",
            "department": "소프트웨어학과",
            "privacy_consent": True,
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "REGISTRATION_CLOSED"
