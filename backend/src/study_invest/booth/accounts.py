"""Identity, per-session accounts and serializable order execution."""

from __future__ import annotations

import hashlib
import secrets
import unicodedata
from datetime import date, datetime
from fractions import Fraction
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..execution import execute_stock
from ..normalize import normalize_nickname
from ..params import INITIAL_CASH
from ..services.common import DomainError, audit, batch_lock
from .domain import (
    BY_CODE,
    FUNDS,
    active_session,
    fund_buy,
    fund_sell,
    fund_value,
    initial_prices,
    sessions,
    tick_seconds,
)
from .models import BoothAccount, BoothOrder, BoothParticipant, BoothRound, BoothToken


def ensure_rounds(s: Session, day: date) -> list[BoothRound]:
    rows = list(s.scalars(select(BoothRound).order_by(BoothRound.number)))
    if len(rows) != 3:
        batch_lock(s)
        rows = list(s.scalars(select(BoothRound).order_by(BoothRound.number)))
        existing = {r.number for r in rows}
        for spec in sessions(day):
            if spec.number not in existing:
                row = BoothRound(
                    number=spec.number,
                    day=day,
                    opens_at=spec.opens_at,
                    closes_at=spec.closes_at,
                    state="pending",
                    version=0,
                    prices=initial_prices(),
                    private={},
                )
                s.add(row)
                rows.append(row)
        s.flush()
    if any(r.day != day for r in rows):
        raise DomainError("EVENT_DATE_MISMATCH", "저장된 행사 날짜와 설정이 다릅니다.", 503)
    return sorted(rows, key=lambda r: r.number)


def lock_round(s: Session, round_id: int, *, shared: bool = False) -> BoothRound:
    row = s.scalar(
        select(BoothRound)
        .where(BoothRound.number == round_id)
        .with_for_update(read=shared)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise DomainError("ROUND_NOT_FOUND", "없는 장입니다.", 404)
    return row


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(s: Session, participant: BoothParticipant, now: datetime) -> str:
    token = secrets.token_urlsafe(32)
    s.add(BoothToken(token_hash=token_hash(token), participant_id=participant.id, created_at=now))
    return token


def participant_for(
    s: Session, token: str | None, *, required: bool = False
) -> BoothParticipant | None:
    record = s.get(BoothToken, token_hash(token)) if token else None
    person = s.get(BoothParticipant, record.participant_id) if record else None
    if (token or required) and person is None:
        raise DomainError(
            "UNAUTHORIZED", "참가 정보가 만료됐습니다. 다시 참가하거나 운영자에게 문의하세요.", 401
        )
    return person


def register(s: Session, nickname: str, now: datetime, day: date) -> tuple[BoothParticipant, str]:
    if now >= sessions(day)[-1].closes_at:
        raise DomainError("EVENT_ENDED", "모든 장이 종료되었습니다.")
    name = normalize_nickname(nickname)
    if not 1 <= len(name) <= 32 or any(unicodedata.category(c).startswith("C") for c in name):
        raise DomainError("INVALID_NICKNAME", "닉네임은 공백이 아닌 1~32자로 입력하세요.", 422)
    if s.scalar(select(BoothParticipant.id).where(BoothParticipant.nickname == name)):
        raise DomainError("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.")
    person = BoothParticipant(nickname=name, joined_at=now)
    s.add(person)
    s.flush()
    token = issue_token(s, person, now)
    audit(s, now, f"booth:{person.id}", "booth.join", nickname=name)
    return person, token


def get_account(s: Session, round_id: int, participant_id: int) -> BoothAccount | None:
    return s.scalar(
        select(BoothAccount).where(
            BoothAccount.round_id == round_id,
            BoothAccount.owner == f"p:{participant_id}",
        )
    )


def enroll(s: Session, row: BoothRound, person: BoothParticipant, now: datetime) -> BoothAccount:
    account = get_account(s, row.number, person.id)
    if account:
        return account
    if now >= row.closes_at or row.state == "closed":
        raise DomainError("ROUND_CLOSED", "종료된 장에는 참가할 수 없습니다.")
    account = BoothAccount(
        round_id=row.number,
        owner=f"p:{person.id}",
        participant_id=person.id,
        cash=INITIAL_CASH,
        stocks={},
        funds={},
        joined_at=now,
    )
    s.add(account)
    s.flush()
    audit(s, now, f"booth:{person.id}", "booth.enroll", round_id=row.number)
    return account


def assert_open(row: BoothRound, now: datetime) -> None:
    spec = active_session(now, row.day)
    if row.state != "open" or spec is None or spec.number != row.number:
        raise DomainError("MARKET_CLOSED", "지금은 이 장의 거래 시간이 아닙니다.")
    if row.published_at is None or (now - row.published_at).total_seconds() >= 3 * tick_seconds(
        row.private
    ):
        raise DomainError("STALE_PRICE", "시세 갱신이 지연되어 거래를 잠시 멈췄습니다.")


def stock_value(account: BoothAccount, prices: dict[str, int]) -> int:
    return sum(int(h["quantity"]) * prices[c] for c, h in account.stocks.items())


def model_assets(s: Session, row: BoothRound) -> dict[str, int]:
    accounts = s.scalars(
        select(BoothAccount).where(
            BoothAccount.round_id == row.number,
            BoothAccount.fund_code.is_not(None),
        )
    )
    result = {code: INITIAL_CASH for code in FUNDS}
    result.update(
        {
            a.fund_code: a.cash + stock_value(a, row.prices)
            for a in accounts
            if a.fund_code is not None
        }
    )
    return result


def valuation(account: BoothAccount, prices: dict[str, int], assets: dict[str, int]) -> Fraction:
    return Fraction(account.cash + stock_value(account, prices)) + sum(
        (fund_value(int(h["units"]), assets[c]) for c, h in account.funds.items()),
        Fraction(0),
    )


def stock_order(
    s: Session,
    row: BoothRound,
    account: BoothAccount,
    code: str,
    side: str,
    quantity: int,
    now: datetime,
    request_id: str,
    payload: dict[str, Any],
) -> BoothOrder:
    if code not in BY_CODE:
        raise DomainError("UNKNOWN_INSTRUMENT", "없는 종목입니다.", 422)
    if account.disqualified:
        raise DomainError("DISQUALIFIED", "이 장에서 실격 처리된 계좌입니다.", 403)
    price = row.prices[code]
    holding = account.stocks.get(code, {"quantity": 0, "cost": 0})
    cash, held, cost = execute_stock(
        account.cash, holding["quantity"], holding["cost"], side, quantity, price
    )
    account.cash = cash
    account.stocks = dict(account.stocks, **{code: {"quantity": held, "cost": cost}})
    return record_order(
        s,
        row,
        account,
        request_id,
        payload,
        {
            "kind": "stock",
            "code": code,
            "side": side,
            "quantity": quantity,
            "price": price,
            "amount": quantity * price,
        },
        now,
    )


def record_order(
    s: Session,
    row: BoothRound,
    account: BoothAccount,
    request_id: str,
    payload: dict[str, Any],
    result: dict[str, Any],
    now: datetime,
) -> BoothOrder:
    order = BoothOrder(
        account_id=account.id,
        round_id=row.number,
        request_id=request_id,
        payload=payload,
        result=result,
        price_version=row.version,
        created_at=now,
    )
    if account.first_trade_at is None:
        account.first_trade_at = now
    s.add(order)
    s.flush()
    audit(
        s,
        now,
        account.owner,
        "booth.order",
        round_id=row.number,
        order_id=order.id,
        price_version=row.version,
        **result,
    )
    return order


def place_order(
    s: Session,
    row: BoothRound,
    account: BoothAccount,
    payload: dict[str, Any],
    now: datetime,
) -> BoothOrder:
    request_id = str(payload["request_id"])
    previous = s.scalar(
        select(BoothOrder).where(
            BoothOrder.account_id == account.id,
            BoothOrder.request_id == request_id,
        )
    )
    if previous:
        if previous.payload != payload:
            raise DomainError("REQUEST_CONFLICT", "같은 요청 번호에 다른 주문 내용이 있습니다.")
        return previous
    assert_open(row, now)
    if account.disqualified:
        raise DomainError("DISQUALIFIED", "이 장에서 실격 처리된 계좌입니다.", 403)
    code, side = str(payload["code"]), str(payload["side"])
    if payload["kind"] == "stock":
        return stock_order(
            s, row, account, code, side, int(payload["quantity"]), now, request_id, payload
        )
    if code not in FUNDS:
        raise DomainError("UNKNOWN_FUND", "없는 펀드입니다.", 422)
    assets = model_assets(s, row)[code]
    holding = account.funds.get(code, {"units": 0, "cost": 0})
    if side == "buy":
        amount = int(payload["amount"])
        if amount > account.cash:
            raise DomainError("INSUFFICIENT_CASH", "현금 잔고가 부족합니다.")
        units, amount = fund_buy(amount, assets)
        account.cash -= amount
        held, cost = holding["units"] + units, holding["cost"] + amount
    else:
        units = int(payload["units"])
        if units > holding["units"]:
            raise DomainError("INSUFFICIENT_HOLDINGS", "보유 좌수가 부족합니다.")
        amount = fund_sell(units, assets)
        account.cash += amount
        held = holding["units"] - units
        cost = holding["cost"] * held // holding["units"] if held else 0
    account.funds = dict(account.funds, **{code: {"units": held, "cost": cost}})
    return record_order(
        s,
        row,
        account,
        request_id,
        payload,
        {
            "kind": "fund",
            "code": code,
            "side": side,
            "units": units,
            "price": assets / 1000,
            "model_assets": assets,
            "amount": amount,
        },
        now,
    )


def revoke(s: Session, token: str) -> None:
    s.execute(delete(BoothToken).where(BoothToken.token_hash == token_hash(token)))
