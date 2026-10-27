"""Booth constants and pure financial/strategy calculations."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time
from fractions import Fraction
from typing import Any

from ..event_calendar import to_kst
from ..instruments import Instrument, InstrumentKind
from ..params import INITIAL_CASH, KST
from ..services.common import DomainError

MICRO = 1_000_000
UNIT_DENOMINATOR = 1_000 * MICRO
EVENT_DAY = date(2026, 10, 30)
TICK_SECONDS = 30
FUND_INTERVAL_SECONDS = 30


def tick_seconds(config: Mapping[str, Any]) -> int:
    """Keep an already-open session's cadence so its stored versions stay valid."""
    return int(config.get("tick_seconds", 10 if config.get("seed") else TICK_SECONDS))


FUNDS = {
    "HERB": {
        "name": "초식이의 분산 펀드",
        "style": "분산형",
        "icon": "🦕",
        "description": "여섯 종목 각 10%와 현금 40%를 목표로 분산합니다.",
    },
    "RAPT": {
        "name": "랩터의 추격 펀드",
        "style": "추세형",
        "icon": "🦖",
        "description": "최근 상승한 상위 두 종목 각 40%, 나머지는 현금으로 보관합니다.",
    },
    "TREX": {
        "name": "티렉스의 역발상 펀드",
        "style": "역추세형",
        "icon": "☄",
        "description": "최근 하락한 상위 두 종목 각 35%로 반등을 노립니다.",
    },
}
INSTRUMENTS = tuple(
    Instrument(code, name, code, InstrumentKind.STOCK, price)
    for code, name, price in (
        ("FEED", "쥐라기 사료", 10_000),
        ("EGG", "공룡알 바이오", 20_000),
        ("PANG", "판게아 건설", 25_000),
        ("FOSS", "화석 에너지", 15_000),
        ("GUARD", "운석 방위산업", 40_000),
        ("ORBIT", "궤도 관측소", 30_000),
    )
)
BY_CODE = {i.code: i for i in INSTRUMENTS}
SECTORS = {
    "feed": {"name": "사료·바이오", "codes": ("FEED", "EGG")},
    "build": {"name": "건설·자원", "codes": ("PANG", "FOSS")},
    "space": {"name": "우주·방위", "codes": ("GUARD", "ORBIT")},
}


@dataclass(frozen=True)
class SessionSpec:
    number: int
    era: str
    opens_at: datetime
    closes_at: datetime


def sessions(day: date) -> tuple[SessionSpec, ...]:
    return tuple(
        SessionSpec(n, era, datetime.combine(day, start, KST), datetime.combine(day, end, KST))
        for n, era, start, end in (
            (1, "트라이아스기", time(16), time(16, 50)),
            (2, "쥐라기", time(17), time(17, 50)),
            (3, "백악기", time(19, 30), time(20, 20)),
        )
    )


def active_session(now: datetime, day: date) -> SessionSpec | None:
    local = to_kst(now)
    return next((s for s in sessions(day) if s.opens_at <= local < s.closes_at), None)


def fund_value(units: int, model_assets: int) -> Fraction:
    return Fraction(units * model_assets, UNIT_DENOMINATOR)


def fund_buy(amount: int, model_assets: int) -> tuple[int, int]:
    if amount <= 0 or model_assets <= 0:
        raise DomainError("INVALID_AMOUNT", "투자 금액은 1원 이상이어야 합니다.", 422)
    units = amount * UNIT_DENOMINATOR // model_assets
    if not units:
        raise DomainError("AMOUNT_TOO_SMALL", "펀드 최소 좌수보다 작은 금액입니다.", 422)
    value = fund_value(units, model_assets)
    charged = -(-value.numerator // value.denominator)
    return units, charged


def fund_sell(units: int, model_assets: int) -> int:
    if units <= 0 or model_assets <= 0:
        raise DomainError("INVALID_QUANTITY", "환매 좌수는 0보다 커야 합니다.", 422)
    return int(fund_value(units, model_assets))


def strategy_targets(code: str, history: list[dict[str, int]]) -> dict[str, Fraction]:
    if code == "HERB":
        return {i.code: Fraction(1, 10) for i in INSTRUMENTS}
    if code not in FUNDS:
        raise DomainError("UNKNOWN_FUND", "없는 펀드입니다.", 422)
    if len(history) < 7:
        return {}
    previous, current = history[-7], history[-1]
    rates = {c: Fraction(current[c] - previous[c], previous[c]) for c in BY_CODE}
    if code == "RAPT":
        selected = sorted((c for c in rates if rates[c] > 0), key=lambda c: (-rates[c], c))[:2]
        weight = Fraction(2, 5)
    else:
        selected = sorted((c for c in rates if rates[c] < 0), key=lambda c: (rates[c], c))[:2]
        weight = Fraction(7, 20)
    return {c: weight for c in selected}


def initial_prices() -> dict[str, int]:
    return {i.code: i.initial_price for i in INSTRUMENTS}


def principal() -> int:
    return INITIAL_CASH
