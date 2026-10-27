"""Shared cash/position arithmetic for study and booth orders."""

from fractions import Fraction

from .money import round_half_up
from .params import QUANTITY_MAX
from .services.common import DomainError


def execute_stock(
    cash: int,
    quantity: int,
    cost: int,
    side: str,
    ordered: int,
    price: int,
) -> tuple[int, int, int]:
    if (
        isinstance(ordered, bool)
        or not isinstance(ordered, int)
        or not 1 <= ordered <= QUANTITY_MAX
    ):
        raise DomainError("INVALID_QUANTITY", "수량은 1 이상의 정수여야 합니다.", 422)
    amount = price * ordered
    if side == "buy":
        if cash < amount:
            raise DomainError("INSUFFICIENT_CASH", "현금 잔고가 부족합니다.")
        return cash - amount, quantity + ordered, cost + amount
    if side != "sell":
        raise DomainError("INVALID_SIDE", "매수 또는 매도를 선택하세요.", 422)
    if quantity < ordered:
        raise DomainError("INSUFFICIENT_HOLDINGS", "보유 수량이 부족합니다.")
    removed = round_half_up(Fraction(cost * ordered, quantity), 1)
    remaining = quantity - ordered
    return cash + amount, remaining, 0 if remaining == 0 else cost - removed
