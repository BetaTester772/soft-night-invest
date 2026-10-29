"""Strict server-side bounds for the booth write APIs."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .domain import TICK_SECONDS

Positive = Annotated[int, Field(strict=True, ge=1, le=10**15)]
RoundId = Annotated[int, Field(strict=True, ge=1, le=3)]


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Enroll(Body):
    round_id: RoundId


class Order(Enroll):
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9:_-]+$")
    kind: Literal["stock", "fund"]
    code: str = Field(min_length=1, max_length=16)
    side: Literal["buy", "sell"]
    quantity: Annotated[int, Field(strict=True, ge=1, le=10**9)] | None = None
    amount: Positive | None = None
    units: Positive | None = None

    @model_validator(mode="after")
    def check_fields(self) -> Self:
        needed = "quantity" if self.kind == "stock" else "amount" if self.side == "buy" else "units"
        if getattr(self, needed) is None:
            raise ValueError(f"{needed} is required")
        if any(
            getattr(self, field) is not None
            for field in ("quantity", "amount", "units")
            if field != needed
        ):
            raise ValueError("only the order's quantity, amount, or units is allowed")
        return self


class Control(Enroll):
    action: Literal["pause", "resume"]
    reason: str = Field(min_length=1, max_length=300)


class Incident(Enroll):
    sector: Literal["feed", "build", "space"]
    rate: float = Field(ge=-0.5, le=0.5, allow_inf_nan=False)
    headline: str = Field(min_length=1, max_length=160)
    reason: str = Field(min_length=1, max_length=300)


class News(Enroll):
    headline: str = Field(min_length=1, max_length=160)
    reason: str = Field(min_length=1, max_length=300)


class Disqualify(Enroll):
    participant_id: Positive
    reason: str = Field(min_length=1, max_length=300)


class Confirm(Enroll):
    revision: Annotated[int, Field(strict=True, ge=1)]


class Step(Body):
    seconds: Annotated[int, Field(strict=True, ge=1, le=TICK_SECONDS)]


class Recover(Body):
    participant_id: Positive
    reason: str = Field(min_length=1, max_length=300)


class GrantCash(Disqualify):
    amount: Annotated[int, Field(strict=True, ge=1, le=100_000_000)]
