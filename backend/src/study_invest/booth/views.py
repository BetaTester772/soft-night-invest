"""One coherent public snapshot, evaluated at the selected price version."""

from __future__ import annotations

from datetime import datetime
from fractions import Fraction
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..params import INITIAL_CASH, KST
from ..services.common import DomainError
from .accounts import assert_open, get_account, model_assets, stock_value, valuation
from .domain import FUNDS, INSTRUMENTS, SECTORS, fund_value, tick_seconds
from .models import (
    BoothAccount,
    BoothEvent,
    BoothOrder,
    BoothParticipant,
    BoothResult,
    BoothRound,
    BoothTick,
)


def iso(at: datetime | None) -> str | None:
    return at.astimezone(KST).isoformat() if at else None


def round_view(row: BoothRound, now: datetime) -> dict[str, Any]:
    try:
        assert_open(row, now)
        is_open = True
    except DomainError:
        is_open = False
    return {
        "id": row.number,
        "era": ("트라이아스기", "쥐라기", "백악기")[row.number - 1],
        "opens_at": iso(row.opens_at),
        "closes_at": iso(row.closes_at),
        "state": row.state,
        "is_open": is_open,
        "version": row.version,
        "update_interval_seconds": tick_seconds(row.private),
        "published_at": iso(row.published_at),
        "paused_reason": row.paused_reason,
    }


def order_view(order: BoothOrder) -> dict[str, Any]:
    return {
        "id": order.id,
        **order.result,
        "price_version": order.price_version,
        "created_at": iso(order.created_at),
    }


def account_view(
    s: Session,
    row: BoothRound,
    person: BoothParticipant,
    assets: dict[str, int],
) -> dict[str, Any]:
    account = get_account(s, row.number, person.id)
    base: dict[str, Any] = {
        "participant_id": person.id,
        "nickname": person.nickname,
        "round_id": row.number,
        "enrolled": account is not None,
        "cash": 0,
        "stock_value": 0,
        "fund_value": 0,
        "total_assets": 0,
        "return_rate": 0,
        "holdings": [],
        "funds": [],
        "orders": [],
        "disqualified": False,
        "reason": None,
        "late_join": False,
    }
    if account is None:
        return base
    holdings = []
    for code, h in account.stocks.items():
        if h["quantity"]:
            value = h["quantity"] * row.prices[code]
            holdings.append(
                {
                    "code": code,
                    "name": next(i.name for i in INSTRUMENTS if i.code == code),
                    **h,
                    "price": row.prices[code],
                    "value": value,
                    "profit": value - h["cost"],
                }
            )
    funds = []
    for code, h in account.funds.items():
        if h["units"]:
            value = int(Fraction(h["units"] * assets[code], 1_000_000_000))
            funds.append(
                {
                    "code": code,
                    "name": FUNDS[code]["name"],
                    **h,
                    "nav": assets[code] / 1000,
                    "value": value,
                    "profit": value - h["cost"],
                }
            )
    total = valuation(account, row.prices, assets)
    orders = s.scalars(
        select(BoothOrder)
        .where(BoothOrder.account_id == account.id)
        .order_by(BoothOrder.id.desc())
        .limit(30)
    )
    return dict(
        base,
        cash=account.cash,
        stock_value=stock_value(account, row.prices),
        fund_value=int(total - account.cash - stock_value(account, row.prices)),
        total_assets=int(total),
        return_rate=float((total - INITIAL_CASH) / INITIAL_CASH),
        holdings=holdings,
        funds=funds,
        orders=[order_view(o) for o in orders],
        disqualified=account.disqualified,
        reason=account.reason,
        late_join=account.joined_at > row.opens_at,
    )


def live_ranking(
    s: Session, row: BoothRound, assets: dict[str, int] | None = None
) -> list[dict[str, Any]]:
    if assets is None:
        assets = model_assets(s, row)
    # Project only ranking fields, avoiding a full ORM account per participant.
    records = s.execute(
        select(
            BoothAccount.id,
            BoothAccount.cash,
            BoothAccount.stocks,
            BoothAccount.funds,
            BoothAccount.first_trade_at,
            BoothAccount.participant_id,
            BoothParticipant.nickname,
        )
        .join(BoothParticipant, BoothParticipant.id == BoothAccount.participant_id)
        .where(BoothAccount.round_id == row.number, BoothAccount.disqualified.is_(False))
    )
    valued: list[tuple[int | Fraction, datetime | None, int, int, str]] = []
    for account_id, cash, stocks, holdings, first_trade, participant_id, nickname in records:
        assert participant_id is not None
        # Preserve exact fractional fund values, but keep stock-only balances integers.
        value: int | Fraction = cash + sum(
            int(h["quantity"]) * row.prices[c] for c, h in stocks.items()
        )
        value += sum(fund_value(int(h["units"]), assets[c]) for c, h in holdings.items())
        valued.append((value, first_trade, account_id, participant_id, nickname))
    valued.sort(key=lambda r: (-r[0], r[1].timestamp() if r[1] else float("inf"), r[2]))
    entries = []
    award_rank = 0
    for index, (value, first_trade, _, participant_id, nickname) in enumerate(valued, 1):
        eligible = first_trade is not None
        if eligible:
            award_rank += 1
        entries.append(
            {
                "rank": index,
                "award_rank": award_rank if eligible else None,
                "participant_id": participant_id,
                "nickname": nickname,
                "total_assets": int(value),
                "return_rate": float((value - INITIAL_CASH) / INITIAL_CASH),
                "eligible": eligible,
                "first_trade_at": iso(first_trade),
            }
        )
    return entries


def latest_result(s: Session, round_id: int) -> BoothResult | None:
    return s.scalar(
        select(BoothResult)
        .where(BoothResult.round_id == round_id)
        .order_by(BoothResult.revision.desc())
        .limit(1)
    )


def result_view(result: BoothResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {
        "round_id": result.round_id,
        "revision": result.revision,
        "confirmed": result.confirmed,
        "entries": result.entries,
        "created_at": iso(result.created_at),
    }


def snapshot(
    s: Session,
    rows: list[BoothRound],
    row: BoothRound,
    person: BoothParticipant | None,
    now: datetime,
) -> dict[str, Any]:
    assets = model_assets(s, row)
    ticks = list(
        s.scalars(
            select(BoothTick).where(BoothTick.round_id == row.number).order_by(BoothTick.number)
        )
    )
    instruments = []
    for inst in INSTRUMENTS:
        sector = next(info["name"] for info in SECTORS.values() if inst.code in info["codes"])
        history = [{"x": iso(t.created_at), "y": t.prices[inst.code]} for t in ticks]
        instruments.append(
            {
                "code": inst.code,
                "name": inst.name,
                "sector": sector,
                "price": row.prices[inst.code],
                "initial_price": inst.initial_price,
                "return_rate": (row.prices[inst.code] - inst.initial_price) / inst.initial_price,
                "history": history or [{"x": iso(row.opens_at), "y": inst.initial_price}],
            }
        )
    fund_accounts = {
        a.fund_code: a
        for a in s.scalars(
            select(BoothAccount).where(
                BoothAccount.round_id == row.number,
                BoothAccount.fund_code.is_not(None),
            )
        )
    }
    funds = []
    for code, definition in FUNDS.items():
        account = fund_accounts.get(code)
        total = assets[code]
        weights = (
            {
                c: h["quantity"] * row.prices[c] / total
                for c, h in account.stocks.items()
                if h["quantity"]
            }
            if account
            else {}
        )
        weights["CASH"] = account.cash / total if account else 1
        decisions = [
            (t, t.detail.get("decisions", {}).get(code))
            for t in ticks
            if code in t.detail.get("decisions", {})
        ]
        last, detail = decisions[-1] if decisions else (None, None)
        history = [
            {
                "x": iso(t.created_at),
                "y": t.detail.get("fund_assets", {}).get(code, INITIAL_CASH) / 1000,
            }
            for t in ticks
        ]
        funds.append(
            {
                "code": code,
                **definition,
                "nav": total / 1000,
                "return_rate": (total - INITIAL_CASH) / INITIAL_CASH,
                "weights": weights,
                "reason": detail["reason"] if detail else "개장 후 운용을 시작합니다.",
                "last_decision_at": iso(last.created_at) if last else None,
                "history": history or [{"x": iso(row.opens_at), "y": 1000}],
            }
        )
    revisions = (
        select(BoothResult.round_id, func.max(BoothResult.revision).label("revision"))
        .group_by(BoothResult.round_id)
        .subquery()
    )
    latest = {
        found.round_id: found
        for found in s.scalars(
            select(BoothResult).join(
                revisions,
                (BoothResult.round_id == revisions.c.round_id)
                & (BoothResult.revision == revisions.c.revision),
            )
        )
    }
    result = latest.get(row.number)
    events = s.scalars(
        select(BoothEvent)
        .where(BoothEvent.round_id == row.number)
        .order_by(BoothEvent.id.desc())
        .limit(30)
    )
    return {
        "now": iso(now),
        "rounds": [round_view(r, now) for r in rows],
        "selected_round": row.number,
        "round": round_view(row, now),
        "instruments": instruments,
        "funds": funds,
        "events": [
            {
                "id": e.id,
                "kind": e.kind,
                "headline": e.headline,
                "sector": e.sector,
                "rates": e.rates,
                "created_at": iso(e.created_at),
            }
            for e in events
        ],
        "ranking": result.entries if result else live_ranking(s, row, assets),
        "result": result_view(result),
        "results": [result_view(found) for r in rows if (found := latest.get(r.number))],
        "me": account_view(s, row, person, assets) if person else None,
    }
