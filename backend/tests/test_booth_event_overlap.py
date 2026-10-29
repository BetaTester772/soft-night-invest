from datetime import timedelta

import pytest
from conftest import Clock
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_booth_api import ADMIN, boot

from study_invest.booth.models import BoothEvent, BoothRound


@pytest.mark.parametrize("kind", ["news", "incident"])
def test_queued_publication_preserves_scheduled_ghost(
    client: TestClient,
    clock: Clock,
    kind: str,
) -> None:
    boot(client, clock)
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        row = session.get(BoothRound, 1)
        assert row is not None
        row.private = dict(row.private, ghosts=[2, 5])
        session.commit()
    clock.now += timedelta(seconds=30)
    assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
    body: dict[str, object] = {"round_id": 1, "headline": "운영 공지", "reason": "test"}
    if kind == "incident":
        body.update(sector="build", rate=0.2)
    response = client.post("/api/booth/admin/" + kind, json=body, headers=ADMIN)
    assert response.status_code == 200, response.text
    for tick_number in range(2, 6):
        clock.now += timedelta(seconds=30)
        assert client.post("/api/booth/admin/run", headers=ADMIN).status_code == 200
        if tick_number == 2:
            overlap = client.get("/api/booth/state").json()["events"]
            assert len(overlap) == 2
            assert {e["kind"] for e in overlap} == {
                "ghost",
                "manual" if kind == "incident" else "news",
            }
    events = client.get("/api/booth/state").json()["events"]
    assert len(events) == 1
    assert events[0]["kind"] == "ghost"
    with factory() as session:
        stored = list(session.scalars(select(BoothEvent).where(BoothEvent.round_id == 1)))
        assert len([e for e in stored if e.kind == "ghost"]) == 2
        assert len([e for e in stored if e.headline == "운영 공지"]) == 1
