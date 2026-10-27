import itertools

from study_invest.booth.market import ghost_schedule


def test_event_schedule_preserves_count_windows_and_spacing() -> None:
    for number in (1, 2, 3):
        for seed in range(100):
            ticks = ghost_schedule(str(seed), number)
            assert len(ticks) == number * 2
            assert min(ticks) >= 6
            assert max(ticks) < 297
            assert all(b - a >= 9 for a, b in itertools.pairwise(ticks))
            assert 240 not in ticks
