import itertools

import pytest

from study_invest.booth.market import ghost_schedule


@pytest.mark.parametrize("interval", [10, 30])
def test_event_schedule_preserves_count_windows_and_spacing(interval: int) -> None:
    for number in (1, 2, 3):
        for seed in range(100):
            ticks = ghost_schedule(str(seed), number, interval)
            assert len(ticks) == number * 2
            assert min(ticks) * interval >= 60
            assert max(ticks) * interval < 2970
            assert all((b - a) * interval >= 90 for a, b in itertools.pairwise(ticks))
            assert 2400 // interval not in ticks


def test_new_session_times_and_break_boundaries() -> None:
    from datetime import date, datetime, time

    from study_invest.booth.domain import active_session, sessions
    from study_invest.params import KST

    day = date(2026, 10, 30)
    assert [(r.opens_at.time(), r.closes_at.time()) for r in sessions(day)] == [
        (time(17), time(17, 50)),
        (time(18, 30), time(19, 20)),
        (time(19, 30), time(20, 20)),
    ]
    for hour, minute in [(16, 59), (17, 50), (18, 29), (19, 20), (20, 20)]:
        assert active_session(datetime.combine(day, time(hour, minute), KST), day) is None
    for number, hour, minute in [(1, 17, 0), (2, 18, 30), (3, 19, 30)]:
        row = active_session(datetime.combine(day, time(hour, minute), KST), day)
        assert row is not None and row.number == number
