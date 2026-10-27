from datetime import date, datetime
from fractions import Fraction

import pytest

from study_invest.booth.domain import (
    INSTRUMENTS,
    active_session,
    fund_buy,
    fund_sell,
    fund_value,
    sessions,
    strategy_targets,
)
from study_invest.execution import execute_stock
from study_invest.params import KST
from study_invest.services.common import DomainError


def at(hour: int, minute: int, second: int = 0) -> datetime:
    return datetime(2026, 10, 30, hour, minute, second, tzinfo=KST)


def test_session_boundaries_and_dinner_break() -> None:
    day = date(2026, 10, 30)
    assert [s.number for s in sessions(day)] == [1, 2, 3]
    assert active_session(at(16, 0), day).number == 1  # type: ignore[union-attr]
    assert active_session(at(16, 49, 59), day).number == 1  # type: ignore[union-attr]
    assert active_session(at(16, 50), day) is None
    assert active_session(at(17, 50), day) is None
    assert active_session(at(19, 29, 59), day) is None
    assert active_session(at(19, 30), day).number == 3  # type: ignore[union-attr]
    assert active_session(at(20, 20), day) is None


def test_shared_execution_removes_proportional_cost() -> None:
    assert execute_stock(100, 3, 100, "sell", 1, 40) == (140, 2, 67)
    assert execute_stock(100, 0, 0, "buy", 2, 40) == (20, 2, 80)
    with pytest.raises(DomainError, match="현금"):
        execute_stock(10, 0, 0, "buy", 1, 40)
    with pytest.raises(DomainError, match="보유"):
        execute_stock(10, 0, 0, "sell", 1, 40)


@pytest.mark.parametrize("assets", [60_001, 999_999, 1_000_000, 1_123_457, 9_999_999])
def test_fund_round_trip_cannot_create_money(assets: int) -> None:
    units, charged = fund_buy(100_000, assets)
    assert 0 < charged <= 100_000
    assert 0 <= charged - fund_sell(units, assets) <= 1
    assert fund_value(units, assets) == Fraction(units * assets, 1_000_000_000)


def test_fund_investor_does_not_receive_past_performance() -> None:
    units, charged = fund_buy(100_000, 1_200_000)
    assert charged == 100_000
    assert fund_sell(units, 1_200_000) <= 100_000
    assert fund_sell(units, 1_320_000) == 109_999


def test_strategies_use_only_available_history_and_sign() -> None:
    current = {i.code: i.initial_price for i in INSTRUMENTS}
    assert strategy_targets("HERB", [current]) == {i.code: Fraction(1, 10) for i in INSTRUMENTS}
    assert strategy_targets("RAPT", [current]) == {}
    rising = dict(current, FEED=11_000, EGG=22_000)
    assert strategy_targets("RAPT", [current] * 6 + [rising]) == {
        "EGG": Fraction(2, 5),
        "FEED": Fraction(2, 5),
    }
    assert strategy_targets("TREX", [current] * 6 + [rising]) == {}
    falling = dict(current, FEED=9_000, EGG=18_000)
    assert strategy_targets("TREX", [current] * 6 + [falling]) == {
        "EGG": Fraction(7, 20),
        "FEED": Fraction(7, 20),
    }
