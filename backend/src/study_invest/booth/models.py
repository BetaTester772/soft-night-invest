"""Booth ledgers. Each financial record belongs to exactly one session."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from ..models import AwareDateTime


class BoothParticipant(Base):
    __tablename__ = "booth_participants"
    id: Mapped[int] = mapped_column(primary_key=True)
    nickname: Mapped[str] = mapped_column(String(32), unique=True)
    joined_at: Mapped[datetime] = mapped_column(AwareDateTime())


class BoothToken(Base):
    __tablename__ = "booth_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("booth_participants.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(AwareDateTime())


class BoothRound(Base):
    __tablename__ = "booth_rounds"
    number: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date)
    opens_at: Mapped[datetime] = mapped_column(AwareDateTime())
    closes_at: Mapped[datetime] = mapped_column(AwareDateTime())
    state: Mapped[str] = mapped_column(String(16), default="pending")
    version: Mapped[int] = mapped_column(default=0)
    prices: Mapped[dict[str, int]] = mapped_column(JSON)
    published_at: Mapped[datetime | None] = mapped_column(AwareDateTime())
    paused_reason: Mapped[str | None] = mapped_column(String(300))
    private: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class BoothAccount(Base):
    __tablename__ = "booth_accounts"
    __table_args__ = (UniqueConstraint("round_id", "owner"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("booth_rounds.number"), index=True)
    owner: Mapped[str] = mapped_column(String(40))
    participant_id: Mapped[int | None] = mapped_column(
        ForeignKey("booth_participants.id"), index=True
    )
    fund_code: Mapped[str | None] = mapped_column(String(16))
    cash: Mapped[int] = mapped_column(BigInteger)
    stocks: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    funds: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    joined_at: Mapped[datetime] = mapped_column(AwareDateTime())
    first_trade_at: Mapped[datetime | None] = mapped_column(AwareDateTime())
    disqualified: Mapped[bool] = mapped_column(default=False)
    reason: Mapped[str | None] = mapped_column(String(300))


class BoothOrder(Base):
    __tablename__ = "booth_orders"
    __table_args__ = (UniqueConstraint("account_id", "request_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("booth_accounts.id"), index=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("booth_rounds.number"), index=True)
    request_id: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any]] = mapped_column(JSON)
    price_version: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(AwareDateTime())


class BoothTick(Base):
    __tablename__ = "booth_ticks"
    round_id: Mapped[int] = mapped_column(ForeignKey("booth_rounds.number"), primary_key=True)
    number: Mapped[int] = mapped_column(primary_key=True)
    prices: Mapped[dict[str, int]] = mapped_column(JSON)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(AwareDateTime())


class BoothEvent(Base):
    __tablename__ = "booth_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    round_id: Mapped[int] = mapped_column(ForeignKey("booth_rounds.number"), index=True)
    tick: Mapped[int] = mapped_column()
    kind: Mapped[str] = mapped_column(String(20))
    headline: Mapped[str] = mapped_column(String(160))
    sector: Mapped[str | None] = mapped_column(String(16))
    rates: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(AwareDateTime())


class BoothResult(Base):
    __tablename__ = "booth_results"
    round_id: Mapped[int] = mapped_column(ForeignKey("booth_rounds.number"), primary_key=True)
    revision: Mapped[int] = mapped_column(primary_key=True)
    entries: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    confirmed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(AwareDateTime())
