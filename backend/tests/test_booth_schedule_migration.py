from datetime import date, datetime, time
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from typing import cast

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session

from study_invest.booth.domain import initial_prices
from study_invest.booth.models import BoothRound
from study_invest.params import KST


@pytest.mark.parametrize("second_state", ["pending", "open", "closed"])
def test_schedule_migration_preserves_initialized_and_custom_rounds(second_state: str) -> None:
    spec = spec_from_file_location(
        "schedule_migration",
        Path(__file__).resolve().parents[1] / "migrations/versions/0015_booth_schedule.py",
    )
    assert spec and spec.loader
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    cast(Table, BoothRound.__table__).create(engine)
    day = date(2026, 10, 30)
    with Session(engine) as s:
        for number, start, end, state in [
            (1, time(16), time(16, 50), "pending"),
            (2, time(17), time(17, 50), second_state),
            (3, time(21), time(21, 50), "pending"),
        ]:
            s.add(
                BoothRound(
                    number=number,
                    day=day,
                    opens_at=datetime.combine(day, start, KST),
                    closes_at=datetime.combine(day, end, KST),
                    state=state,
                    version=0,
                    prices=initial_prices(),
                    private={},
                )
            )
        s.commit()
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration.upgrade()
    with Session(engine) as s:
        first, second, third = (s.get(BoothRound, n) for n in (1, 2, 3))
        assert first and second and third
        assert first.opens_at.astimezone(KST).time() == time(17)
        assert first.closes_at.astimezone(KST).time() == time(17, 50)
        assert second.opens_at.astimezone(KST).time() == (
            time(18, 30) if second_state == "pending" else time(17)
        )
        assert second.state == second_state
        assert third.opens_at.astimezone(KST).time() == time(21)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration.downgrade()
        migration.upgrade()
    with Session(engine) as s:
        first = s.get(BoothRound, 1)
        assert first and first.opens_at.astimezone(KST).time() == time(17)
    engine.dispose()
