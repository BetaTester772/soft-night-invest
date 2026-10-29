"""Idempotent session scheduler: publish, operate model funds, freeze results."""

from __future__ import annotations

import random
import secrets
from collections.abc import Callable
from dataclasses import replace
from datetime import date, datetime, timedelta
from fractions import Fraction
from itertools import pairwise
from math import ceil
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..params import EventParams
from ..pricing import combined_rate, draw_stock_randoms, next_stock_price, settle_stocks
from ..services.common import DomainError, audit, batch_lock
from . import funds
from .accounts import ensure_rounds, lock_round
from .domain import FUND_INTERVAL_SECONDS, SECTORS, TICK_SECONDS, initial_prices, tick_seconds
from .models import BoothEvent, BoothOrder, BoothResult, BoothRound, BoothTick
from .news import market_headline
from .views import latest_result, live_ranking

CAPS = {1: 0.004, 2: 0.007, 3: 0.01}
STOCK_MOVE_MULTIPLIER = 100
GHOSTS = {1: (2, 0.05, 0.08), 2: (4, 0.08, 0.15), 3: (6, 0.12, 0.25)}


def publish_event(
    s: Session,
    row: BoothRound,
    tick: int,
    now: datetime,
    *,
    kind: str,
    headline: str,
    sector: str | None = None,
    rates: dict[str, float] | None = None,
) -> None:
    s.add(
        BoothEvent(
            round_id=row.number,
            tick=tick,
            kind=kind,
            headline=headline,
            sector=sector,
            rates=rates or {},
            created_at=now,
        )
    )


def ghost_schedule(seed: str, number: int, interval: int = TICK_SECONDS) -> list[int]:
    rng = random.Random(seed)
    count = GHOSTS[number][0]
    while True:
        candidates = [
            n for n in range(ceil(60 / interval), ceil(2970 / interval)) if n * interval != 2400
        ]
        ticks = sorted(rng.sample(candidates, count))
        if all((b - a) * interval >= 90 for a, b in pairwise(ticks)):
            return ticks


def open_round(s: Session, row: BoothRound, *, seed: str | None = None) -> None:
    seed = seed or secrets.token_hex(24)
    row.private = dict(
        row.private,
        seed=seed,
        tick_seconds=TICK_SECONDS,
        ghosts=ghost_schedule(seed, row.number),
        meteor_done=False,
    )
    row.prices, row.version = initial_prices(), 0
    row.state, row.published_at = "open", row.opens_at
    funds.initialize(s, row, row.opens_at)
    first = BoothTick(
        round_id=row.number, number=0, prices=dict(row.prices), created_at=row.opens_at, detail={}
    )
    s.add(first)
    s.flush()
    decisions = funds.rebalance(s, row, row.opens_at)
    first.detail = {"decisions": decisions, "fund_assets": funds.values(s, row)}
    audit(s, row.opens_at, "system", "booth.open", round_id=row.number)


def open_now(s: Session, row: BoothRound, reason: str, now: datetime) -> None:
    if row.state != "pending":
        raise DomainError("INVALID_STATE", "아직 개장하지 않은 장만 열 수 있습니다.")
    closes_at = now + (row.closes_at - row.opens_at)
    others = s.scalars(select(BoothRound).where(BoothRound.number != row.number))
    if any(
        other.state != "closed" and other.opens_at < closes_at and now < other.closes_at
        for other in others
    ):
        raise DomainError("ROUND_OVERLAP", "다른 장의 운영 시간과 겹칩니다.")
    previous_opens_at, previous_closes_at = row.opens_at, row.closes_at
    row.opens_at, row.closes_at = now, closes_at
    open_round(s, row)
    audit(
        s,
        now,
        "admin",
        "booth.open.manual",
        round_id=row.number,
        reason=reason,
        previous_opens_at=previous_opens_at.isoformat(),
        previous_closes_at=previous_closes_at.isoformat(),
        opens_at=now.isoformat(),
        closes_at=closes_at.isoformat(),
    )


def event_rates(
    s: Session,
    row: BoothRound,
    tick: int,
    now: datetime,
    rng: random.Random,
) -> tuple[dict[str, Fraction], bool]:
    """Return price effects and whether a priority headline was published."""
    data = dict(row.private)
    sector: str | None = None
    rates: dict[str, float] = {}
    kind, headline = "", ""
    if row.number == 3 and tick * tick_seconds(data) >= 2400 and not data.get("meteor_done"):
        success = rng.random() < 0.5
        rates = {
            c: (0.20 if sector_id == "space" else 0.08)
            if success
            else (-0.15 if sector_id == "space" else -0.30)
            for sector_id, info in SECTORS.items()
            for c in info["codes"]
        }
        kind = "meteor"
        headline = (
            "운석 요격 성공! 공룡 증시에 안도의 매수세"
            if success
            else "운석 요격 실패… 공룡 증시 대폭락"
        )
        data["meteor_done"] = True
    elif tick in data.get("ghosts", []):
        sector = rng.choice(list(SECTORS))
        _, lo, hi = GHOSTS[row.number]
        rate = round(rng.uniform(lo, hi), 4) * (1 if rng.random() < 0.5 else -1)
        rates = {c: rate for c in SECTORS[sector]["codes"]}
        kind = "ghost"
        headline = f"공룡 귀신 출몰! {SECTORS[sector]['name']} 섹터 " + (
            "급등" if rate > 0 else "급락"
        )
    if headline:
        publish_event(s, row, tick, now, kind=kind, headline=headline, sector=sector, rates=rates)
    has_alert = bool(headline)
    effects = {c: Fraction(str(rate)) for c, rate in rates.items()}
    if data.get("pending"):
        has_alert = True
        pending = list(data["pending"])
        event = pending.pop(0)
        data["pending"] = pending
        queued_rates = event.get("rates", {})
        publish_event(
            s,
            row,
            tick,
            now,
            kind=event["kind"],
            headline=event["headline"],
            sector=event.get("sector"),
            rates=queued_rates,
        )
        for code, rate in queued_rates.items():
            effects[code] = (1 + effects.get(code, Fraction(0))) * (1 + Fraction(str(rate))) - 1
    row.private = data
    if row.number == 2:
        for code in SECTORS["feed"]["codes"]:
            effects[code] = (1 + effects.get(code, Fraction(0))) * Fraction(10001, 10000) - 1
    return effects, has_alert


def tick(s: Session, row: BoothRound, number: int) -> None:
    elapsed = number * tick_seconds(row.private)
    now = row.opens_at + timedelta(seconds=elapsed)
    rng = random.Random(f"{row.private['seed']}:{number}")
    buys: dict[str, int] = {}
    sells: dict[str, int] = {}
    for order in s.scalars(
        select(BoothOrder).where(
            BoothOrder.round_id == row.number,
            BoothOrder.price_version == row.version,
        )
    ):
        result = order.result
        if result["kind"] == "stock":
            amounts = buys if result["side"] == "buy" else sells
            amounts[result["code"]] = amounts.get(result["code"], 0) + result["amount"]
    params = replace(
        EventParams(),
        stock_move_max=CAPS[row.number],
        stock_move_min=0.0,
        news_good_per_day=0,
        news_bad_per_day=0,
    )
    # Preserve the established RNG order: stock draws precede event draws.
    draws = draw_stock_randoms(row.prices, rng)
    effects, has_alert = event_rates(s, row, number, now, rng)
    moves = settle_stocks(
        row.prices,
        buys,
        sells,
        params,
        draws,
        news=effects,
    )
    previous = row.prices
    # Amplify random moves before event effects, rounding, and the existing price bounds.
    row.prices = {
        code: next_stock_price(
            move.old_price,
            combined_rate(move.rate * STOCK_MOVE_MULTIPLIER, move.news_rate),
            params.stock_min_price,
        )
        for code, move in moves.items()
    }
    if elapsed % 120 == 0 and now < row.closes_at and not has_alert:
        sector, headline = market_headline(previous, row.prices, elapsed // 120)
        publish_event(s, row, number, now, kind="market", headline=headline, sector=sector)
    row.version, row.published_at = number, now
    record = BoothTick(
        round_id=row.number, number=number, prices=dict(row.prices), created_at=now, detail={}
    )
    s.add(record)
    s.flush()
    decisions = (
        funds.rebalance(s, row, now)
        if elapsed % FUND_INTERVAL_SECONDS == 0 and now < row.closes_at
        else {}
    )
    record.detail = {
        "decisions": decisions,
        "fund_assets": funds.values(s, row),
        "flows": {c: m.net_amount for c, m in moves.items()},
    }


def freeze(s: Session, row: BoothRound, now: datetime) -> None:
    if row.state == "closed":
        return
    if row.number == 3 and not row.private.get("meteor_done"):
        publish_event(
            s,
            row,
            row.version,
            now,
            kind="cancelled",
            headline=(
                "운석 사건 취소: 거래 중단 또는 행사 미운영으로 마지막 공개 가격에 정산합니다."
            ),
        )
        row.private = dict(row.private, meteor_done=True)
    row.state = "closed"
    row.paused_reason = None
    if latest_result(s, row.number) is None:
        s.add(
            BoothResult(
                round_id=row.number,
                revision=1,
                entries=live_ranking(s, row),
                confirmed=False,
                created_at=now,
            )
        )
    audit(s, now, "system", "booth.close", round_id=row.number, version=row.version)


def advance(s: Session, row: BoothRound, now: datetime) -> None:
    if row.state == "closed" or now < row.opens_at:
        return
    if row.state == "pending":
        open_round(s, row)
    assert row.published_at is not None
    closing = now >= row.closes_at
    lag = (now - row.published_at).total_seconds()
    interval = tick_seconds(row.private)
    total_ticks = int((row.closes_at - row.opens_at).total_seconds()) // interval
    if row.state == "open" and lag >= 3 * interval:
        if not closing:
            row.state = "paused"
            row.paused_reason = f"시세 계산이 {3 * interval}초 이상 지연되었습니다."
            audit(s, now, "system", "booth.pause", round_id=row.number, reason=row.paused_reason)
            return
    elif row.state == "open":
        target = min(total_ticks, int((now - row.opens_at).total_seconds()) // interval)
        for number in range(row.version + 1, target + 1):
            tick(s, row, number)
    if closing:
        freeze(s, row, now)


def run_due(
    factory: Callable[[], Session],
    now: datetime,
    day: date,
) -> list[dict[str, Any]]:
    results = []
    with factory() as s:
        ensure_rounds(s, day)
        s.commit()
    for number in (1, 2, 3):
        with factory() as s:
            if not batch_lock(s, wait=False):
                break
            row = lock_round(s, number)
            before = row.state, row.version
            advance(s, row, now)
            s.commit()
            if before != (row.state, row.version):
                results.append({"round_id": number, "state": row.state, "version": row.version})
    return results


def control(s: Session, row: BoothRound, action: str, reason: str, now: datetime) -> None:
    if not row.opens_at <= now < row.closes_at or row.state == "closed":
        raise DomainError("MARKET_CLOSED", "거래 시간 중인 장만 제어할 수 있습니다.")
    if action == "pause":
        if row.state != "open":
            raise DomainError("INVALID_STATE", "열린 장만 정지할 수 있습니다.")
        row.state, row.paused_reason = "paused", reason
    else:
        if row.state != "paused":
            raise DomainError("INVALID_STATE", "정지 중인 장만 재개할 수 있습니다.")
        previous = row.version
        interval = tick_seconds(row.private)
        total_ticks = int((row.closes_at - row.opens_at).total_seconds()) // interval
        target = max(
            previous, min(total_ticks - 1, int((now - row.opens_at).total_seconds()) // interval)
        )
        if target > previous:
            s.add(
                BoothTick(
                    round_id=row.number,
                    number=target,
                    prices=dict(row.prices),
                    created_at=now,
                    detail={"skipped": [previous + 1, target], "fund_assets": funds.values(s, row)},
                )
            )
            cancelled = sum(previous < n <= target for n in row.private.get("ghosts", []))
            if cancelled:
                publish_event(
                    s,
                    row,
                    target,
                    now,
                    kind="cancelled",
                    headline=f"거래 정지 중 예정된 공룡 귀신 사건 {cancelled}건을 취소했습니다.",
                )
        row.version, row.published_at = target, now
        row.state, row.paused_reason = "open", None
    audit(s, now, "admin", f"booth.{action}", round_id=row.number, reason=reason)
