"""QA-only session cycling; participant identities and audit history survive resets."""

from datetime import date, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..params import INITIAL_CASH
from ..services.common import audit
from .domain import initial_prices, sessions
from .models import (
    BoothAccount,
    BoothCashGrant,
    BoothEvent,
    BoothOrder,
    BoothResult,
    BoothRound,
    BoothTick,
)


def restart_cycle(s: Session, rows: list[BoothRound], day: date, now: datetime) -> None:
    """Caller holds the batch lock and every round lock until opening round one."""
    for model in (BoothCashGrant, BoothOrder, BoothEvent, BoothResult, BoothTick):
        s.execute(delete(model))
    s.execute(delete(BoothAccount).where(BoothAccount.fund_code.is_not(None)))
    for account in s.scalars(select(BoothAccount).with_for_update()):
        account.cash, account.qa_cash = INITIAL_CASH, 0
        account.stocks, account.funds = {}, {}
        account.joined_at, account.first_trade_at = now, None
        account.disqualified, account.reason = False, None
    specs = sessions(day)
    shift = now - specs[0].opens_at
    for row, spec in zip(rows, specs, strict=True):
        row.opens_at, row.closes_at = spec.opens_at + shift, spec.closes_at + shift
        row.state, row.version = "pending", 0
        row.prices, row.private = initial_prices(), {}
        row.published_at, row.paused_reason = None, None
    audit(s, now, "admin", "booth.qa.restart", round_ids=[r.number for r in rows])
    s.flush()
