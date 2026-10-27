"""Common model portfolios. Subscriptions never affect these model wallets."""

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..params import INITIAL_CASH
from .accounts import model_assets, stock_order, stock_value
from .domain import FUNDS, strategy_targets
from .models import BoothAccount, BoothRound, BoothTick


def initialize(s: Session, row: BoothRound, now: datetime) -> None:
    for code in FUNDS:
        s.add(
            BoothAccount(
                round_id=row.number,
                owner=f"f:{code}",
                participant_id=None,
                fund_code=code,
                cash=INITIAL_CASH,
                stocks={},
                funds={},
                joined_at=now,
            )
        )
    s.flush()


def rebalance(s: Session, row: BoothRound, now: datetime) -> dict[str, Any]:
    history = [
        t.prices
        for t in s.scalars(
            select(BoothTick).where(BoothTick.round_id == row.number).order_by(BoothTick.number)
        )
    ]
    decisions: dict[str, Any] = {}
    accounts = s.scalars(
        select(BoothAccount)
        .where(
            BoothAccount.round_id == row.number,
            BoothAccount.fund_code.is_not(None),
        )
        .order_by(BoothAccount.id)
        .with_for_update()
    )
    for account in accounts:
        code = account.fund_code
        assert code is not None
        targets = strategy_targets(code, history)
        assets = account.cash + stock_value(account, row.prices)
        quantities = {c: int(assets * weight) // row.prices[c] for c, weight in targets.items()}
        orders = []
        for side in ("sell", "buy"):
            for stock in sorted(set(account.stocks) | set(quantities)):
                held = account.stocks.get(stock, {}).get("quantity", 0)
                delta = quantities.get(stock, 0) - held
                if (side == "sell" and delta < 0) or (side == "buy" and delta > 0):
                    qty = abs(delta)
                    if side == "buy":
                        qty = min(qty, account.cash // row.prices[stock])
                    if qty:
                        payload = {"kind": "stock", "code": stock, "side": side, "quantity": qty}
                        order = stock_order(
                            s,
                            row,
                            account,
                            stock,
                            side,
                            qty,
                            now,
                            f"model:{row.version}:{side}:{stock}",
                            payload,
                        )
                        orders.append(order.result)
        reason = (
            "6종목에 각 10% 분산, 나머지는 현금으로 보관합니다."
            if code == "HERB"
            else "공개된 최근 6구간의 "
            + ("상승" if code == "RAPT" else "하락")
            + " 종목을 선택했습니다."
            if targets
            else "조건을 충족한 종목이 없어 현금으로 대기합니다."
        )
        decisions[code] = {
            "reason": reason,
            "targets": {c: float(w) for c, w in targets.items()},
            "orders": orders,
            "input_version": row.version,
        }
    return decisions


def values(s: Session, row: BoothRound) -> dict[str, int]:
    return model_assets(s, row)
