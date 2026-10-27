from datetime import timedelta

from conftest import Clock
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_booth_api import boot, join

from study_invest.booth import accounts, views
from study_invest.booth.models import BoothAccount


def test_ranking_preserves_fractional_values_and_tiebreaks(
    client: TestClient, clock: Clock
) -> None:
    boot(client, clock)
    for n in range(4):
        join(client, f"순위공룡{n}")
    factory = client.app.state.study_invest.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        row = accounts.lock_round(s, 1)
        people = list(
            s.scalars(
                select(BoothAccount)
                .where(BoothAccount.participant_id.is_not(None))
                .order_by(BoothAccount.id)
            )
        )
        for n, account in enumerate(people):
            account.funds = {"HERB": {"units": [0, 1, 2, 1][n], "cost": 0}}
            account.first_trade_at = clock() + timedelta(seconds=4 - n) if n else None
        s.flush()
        assets = accounts.model_assets(s, row)
        ranking = views.live_ranking(s, row, assets)
        expected = sorted(
            people,
            key=lambda a: (
                -accounts.valuation(a, row.prices, assets),
                a.first_trade_at.timestamp() if a.first_trade_at else float("inf"),
                a.id,
            ),
        )
        assert [r["participant_id"] for r in ranking] == [a.participant_id for a in expected]
        assert [r["participant_id"] for r in ranking] == [
            people[n].participant_id for n in (2, 3, 1, 0)
        ]
        assert [r["award_rank"] for r in ranking] == [1, 2, 3, None]
        assert all(r["total_assets"] == 1_000_000 for r in ranking)
