"""Update untouched pending booth rounds to the revised event schedule."""

from datetime import datetime, time, timedelta

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def update_pending_schedule(forward: bool) -> None:
    # Existing timestamps are stored as naive UTC by AwareDateTime.
    rounds = sa.table(
        "booth_rounds",
        sa.column("number", sa.Integer()),
        sa.column("day", sa.Date()),
        sa.column("state", sa.String()),
        sa.column("opens_at", sa.DateTime()),
        sa.column("closes_at", sa.DateTime()),
    )
    connection = op.get_bind()
    changes = [
        (1, time(16), time(16, 50), time(17), time(17, 50)),
        (2, time(17), time(17, 50), time(18, 30), time(19, 20)),
    ]
    for number, old_start, old_end, new_start, new_end in changes:
        for day in connection.execute(
            sa.select(rounds.c.day).where(rounds.c.number == number)
        ).scalars():

            def utc(value: time) -> datetime:
                return datetime.combine(day, value) - timedelta(hours=9)

            before, after = ((old_start, old_end), (new_start, new_end))
            if not forward:
                before, after = after, before
            connection.execute(
                rounds.update()
                .where(
                    rounds.c.number == number,
                    rounds.c.state == "pending",
                    rounds.c.opens_at == utc(before[0]),
                    rounds.c.closes_at == utc(before[1]),
                )
                .values(opens_at=utc(after[0]), closes_at=utc(after[1]))
            )


def upgrade() -> None:
    update_pending_schedule(True)


def downgrade() -> None:
    update_pending_schedule(False)
