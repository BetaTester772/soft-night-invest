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
