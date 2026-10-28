"""Booth HTTP API; DB work stays in sync routes and releases connections promptly."""

from __future__ import annotations

from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select

from ..api.deps import (
    BatchSessionDep,
    MeDep,
    SessionDep,
    SessionReleasingRoute,
    StateDep,
    TokenDep,
    require_admin,
)
from ..clock import OffsetClock
from ..models import Participant
from ..services import auth
from ..services.common import DomainError, audit
from . import accounts, market, schemas, views
from .domain import SECTORS, sessions
from .models import BoothAccount, BoothParticipant, BoothResult, BoothToken
from .views import latest_result

router = APIRouter(prefix="/api/booth", route_class=SessionReleasingRoute, tags=["booth"])
admin = APIRouter(
    prefix="/api/booth/admin",
    route_class=SessionReleasingRoute,
    dependencies=[Depends(require_admin)],
    tags=["booth-admin"],
)


def selected_id(rows: list[Any], now: Any) -> int:
    active = next((r for r in rows if r.opens_at <= now < r.closes_at), None)
    upcoming = next((r for r in rows if r.opens_at > now), None)
    return (active or upcoming or rows[-1]).number  # type: ignore[no-any-return]


@router.get("/config")
def config(state: StateDep) -> dict[str, Any]:
    return {
        "mode": state.settings.event_mode,
        "event_day": state.settings.booth_date.isoformat(),
        "public_url": state.settings.booth_public_url,
        "qa_tools": state.settings.qa_tools,
        "time_scale": state.time_scale,
    }


@router.get("/state")
def state_info(
    state: StateDep,
    s: SessionDep,
    token: TokenDep,
    round_id: Annotated[int | None, Query(ge=1, le=3)] = None,
) -> dict[str, Any]:
    now = state.clock()
    rows = accounts.ensure_rounds(s, state.settings.booth_date)
    row = accounts.lock_round(s, round_id or selected_id(rows, now), shared=True)
    person = accounts.participant_for(s, token)
    if person is not None:
        # Keep this participant's balance, holdings and order history consistent.
        accounts.get_account(s, row.number, person.id, lock="share")
    result = views.snapshot(s, rows, row, person, now)
    s.commit()
    return result


@router.post("/join", status_code=201)
def join(body: schemas.Join, state: StateDep, s: SessionDep) -> dict[str, Any]:
    rows = accounts.ensure_rounds(s, state.settings.booth_date)
    now = state.clock()
    person, token = accounts.register(s, body.nickname, now, state.settings.booth_date)
    row = accounts.lock_round(s, selected_id(rows, now))
    accounts.enroll(s, row, person, state.clock())
    s.commit()
    return {"token": token, "participant": {"id": person.id, "nickname": person.nickname}}


@router.post("/session")
def login_session(person: MeDep, state: StateDep, s: SessionDep, token: TokenDep) -> dict[str, Any]:
    # Serialize first login for the same identity; never claim a nickname-only account.
    s.scalar(select(Participant).where(Participant.id == person.id).with_for_update())
    # A password reset may have revoked this login while we waited for the lock.
    if token is None or auth.participant_by_token(s, token) is None:
        raise DomainError("UNAUTHORIZED", "로그인이 필요합니다.", 401)
    linked = s.scalar(
        select(BoothParticipant).where(BoothParticipant.study_participant_id == person.id)
    )
    now = state.clock()
    rows = accounts.ensure_rounds(s, state.settings.booth_date)
    if linked is None:
        name = person.nickname
        attempt = 0
        while s.scalar(select(BoothParticipant.id).where(BoothParticipant.nickname == name)):
            suffix = f"·계정{person.id}" + (f"-{attempt}" if attempt else "")
            name = f"{person.nickname[: 32 - len(suffix)]}{suffix}"
            attempt += 1
        linked, token = accounts.register(s, name, now, state.settings.booth_date)
        linked.study_participant_id = person.id
    else:
        token = accounts.issue_token(s, linked, now)
    row = accounts.lock_round(s, selected_id(rows, now))
    if now < row.closes_at and row.state != "closed":
        accounts.enroll(s, row, linked, now)
    s.commit()
    return {"token": token}


@router.post("/enroll")
def enroll(body: schemas.Enroll, state: StateDep, s: SessionDep, token: TokenDep) -> dict[str, Any]:
    accounts.ensure_rounds(s, state.settings.booth_date)
    person = accounts.participant_for(s, token, required=True)
    assert person is not None
    row = accounts.lock_round(s, body.round_id)
    accounts.enroll(s, row, person, state.clock())
    result = views.account_view(s, row, person, accounts.model_assets(s, row))
    s.commit()
    return result


@router.post("/orders", status_code=201)
def order(body: schemas.Order, state: StateDep, s: SessionDep, token: TokenDep) -> dict[str, Any]:
    person = accounts.participant_for(s, token, required=True)
    assert person is not None
    # Orders share a stable price version; only the owner's balance is exclusive.
    # Always lock the round before the account, as scheduler/admin operations do.
    row = accounts.lock_round(s, body.round_id, shared=True)
    account = accounts.get_account(s, row.number, person.id, lock="update")
    if account is None:
        raise DomainError("NOT_ENROLLED", "먼저 이 장에 참가하세요.")
    filled = accounts.place_order(
        s, row, account, body.model_dump(exclude_none=True), state.clock()
    )
    result = {
        "order": views.order_view(filled),
        "me": views.account_view(s, row, person, accounts.model_assets(s, row)),
    }
    s.commit()
    return result


@router.post("/logout", status_code=204)
def logout(s: SessionDep, token: TokenDep) -> Response:
    accounts.participant_for(s, token, required=True)
    assert token is not None
    accounts.revoke(s, token)
    s.commit()
    return Response(status_code=204)


@admin.post("/run")
def run(state: StateDep) -> dict[str, Any]:
    return {
        "results": market.run_due(
            state.batch_session_factory, state.clock(), state.settings.booth_date
        )
    }


@admin.get("/status")
def admin_status(state: StateDep, s: SessionDep) -> dict[str, Any]:
    now = state.clock()
    rows = accounts.ensure_rounds(s, state.settings.booth_date)
    people = {p.id: p.nickname for p in s.scalars(select(BoothParticipant))}
    entries = [
        {
            "participant_id": a.participant_id,
            "nickname": people[a.participant_id] if a.participant_id is not None else "",
            "round_id": a.round_id,
            "disqualified": a.disqualified,
            "reason": a.reason,
        }
        for a in s.scalars(select(BoothAccount).where(BoothAccount.participant_id.is_not(None)))
    ]
    results = [views.result_view(found) for r in rows if (found := latest_result(s, r.number))]
    s.commit()
    return {
        "rounds": [views.round_view(r, now) for r in rows],
        "participants": entries,
        "results": results,
    }


@admin.post("/control")
def control(body: schemas.Control, state: StateDep, s: BatchSessionDep) -> dict[str, Any]:
    row = accounts.lock_round(s, body.round_id)
    market.control(s, row, body.action, body.reason, state.clock())
    result = views.round_view(row, state.clock())
    s.commit()
    return result


def queue_event(body: schemas.Incident | schemas.News, state: Any, s: Any) -> dict[str, str]:
    row = accounts.lock_round(s, body.round_id)
    if row.state == "closed" or state.clock() >= row.closes_at:
        raise DomainError("ROUND_CLOSED", "종료된 장에는 사건을 추가할 수 없습니다.")
    pending = list(row.private.get("pending", []))
    event: dict[str, Any] = {"kind": "news", "headline": body.headline}
    if isinstance(body, schemas.Incident):
        event.update(
            kind="manual",
            sector=body.sector,
            rates={c: body.rate for c in SECTORS[body.sector]["codes"]},
        )
    if len(pending) >= 20:
        raise DomainError("QUEUE_FULL", "대기 중인 뉴스가 너무 많습니다.")
    pending.append(event)
    row.private = dict(row.private, pending=pending)
    audit(
        s,
        state.clock(),
        "admin",
        "booth.event.queue",
        round_id=row.number,
        reason=body.reason,
        event=event,
    )
    s.commit()
    return {"message": "다음 가격 갱신 구간에 공개합니다."}


@admin.post("/incident")
def incident(body: schemas.Incident, state: StateDep, s: BatchSessionDep) -> dict[str, str]:
    return queue_event(body, state, s)


@admin.post("/news")
def news(body: schemas.News, state: StateDep, s: BatchSessionDep) -> dict[str, str]:
    return queue_event(body, state, s)


@admin.post("/disqualify")
def disqualify(body: schemas.Disqualify, state: StateDep, s: BatchSessionDep) -> dict[str, Any]:
    row = accounts.lock_round(s, body.round_id)
    account = accounts.get_account(s, row.number, body.participant_id)
    if account is None:
        raise DomainError("ACCOUNT_NOT_FOUND", "이 장의 참가자가 아닙니다.", 404)
    if not account.disqualified:
        account.disqualified, account.reason = True, body.reason
        result = latest_result(s, row.number)
        if result:
            entries: list[dict[str, Any]] = []
            award_rank = 0
            for old in result.entries:
                if old["participant_id"] == body.participant_id:
                    continue
                if old["eligible"]:
                    award_rank += 1
                entries.append(
                    dict(
                        old,
                        rank=len(entries) + 1,
                        award_rank=award_rank if old["eligible"] else None,
                    )
                )
            s.add(
                BoothResult(
                    round_id=row.number,
                    revision=result.revision + 1,
                    entries=entries,
                    confirmed=False,
                    created_at=state.clock(),
                )
            )
        audit(
            s,
            state.clock(),
            "admin",
            "booth.disqualify",
            round_id=row.number,
            participant_id=body.participant_id,
            reason=body.reason,
        )
    s.commit()
    return {"message": "실격 처리했습니다. 마감 결과가 바뀌었다면 다시 확정하세요."}


@admin.post("/confirm")
def confirm(body: schemas.Confirm, state: StateDep, s: BatchSessionDep) -> dict[str, Any]:
    accounts.lock_round(s, body.round_id)
    result = latest_result(s, body.round_id)
    if result is None or result.revision != body.revision:
        raise DomainError("RESULT_CHANGED", "최신 결과를 다시 확인하세요.")
    result.confirmed = True
    audit(
        s, state.clock(), "admin", "booth.confirm", round_id=body.round_id, revision=body.revision
    )
    s.commit()
    return views.result_view(result) or {}


@admin.post("/recover")
def recover(body: schemas.Recover, state: StateDep, s: BatchSessionDep) -> dict[str, str]:
    person = s.scalar(
        select(BoothParticipant).where(BoothParticipant.id == body.participant_id).with_for_update()
    )
    if person is None:
        raise DomainError("PARTICIPANT_NOT_FOUND", "없는 참가자입니다.", 404)
    s.execute(delete(BoothToken).where(BoothToken.participant_id == person.id))
    token = accounts.issue_token(s, person, state.clock())
    audit(s, state.clock(), "admin", "booth.recover", participant_id=person.id, reason=body.reason)
    s.commit()
    return {"token": token}


def qa_clock(state: Any) -> OffsetClock:
    if not state.settings.qa_tools or not isinstance(state.clock, OffsetClock):
        raise DomainError("NOT_FOUND", "QA 도구가 비활성화되어 있습니다.", 404)
    return state.clock


@admin.post("/qa/step")
def qa_step(body: schemas.Step, state: StateDep) -> dict[str, Any]:
    clock = qa_clock(state)
    results = []
    remaining = body.seconds
    while remaining:
        # Also advance sessions opened by the former ten-second engine safely.
        step = min(10, remaining)
        clock.jump_to(clock() + timedelta(seconds=step))
        results.extend(
            market.run_due(state.batch_session_factory, clock(), state.settings.booth_date)
        )
        remaining -= step
    return {"now": views.iso(clock()), "results": results}


@admin.post("/qa/next")
def qa_next(state: StateDep) -> dict[str, Any]:
    clock = qa_clock(state)
    now = clock()
    upcoming = next((r for r in sessions(state.settings.booth_date) if r.opens_at > now), None)
    if upcoming is None:
        raise DomainError("NO_NEXT_ROUND", "다음 장이 없습니다.")
    clock.jump_to(upcoming.opens_at)
    results = market.run_due(state.batch_session_factory, clock(), state.settings.booth_date)
    return {"now": views.iso(clock()), "results": results}


@admin.post("/qa/cash")
def qa_cash(body: schemas.GrantCash, state: StateDep, s: BatchSessionDep) -> dict[str, Any]:
    if not state.settings.qa_tools:
        raise DomainError("NOT_FOUND", "QA 도구가 비활성화되어 있습니다.", 404)
    row = accounts.lock_round(s, body.round_id)
    if row.state == "closed" or state.clock() >= row.closes_at:
        raise DomainError("ROUND_CLOSED", "종료된 장에는 지급할 수 없습니다.")
    account = accounts.get_account(s, row.number, body.participant_id, lock="update")
    if account is None:
        raise DomainError("ACCOUNT_NOT_FOUND", "이 장의 참가자가 아닙니다.", 404)
    if account.qa_cash + body.amount > 100_000_000:
        raise DomainError("QA_CASH_LIMIT", "장별 테스트 머니 지급 한도는 1억원입니다.")
    account.cash += body.amount
    account.qa_cash += body.amount
    audit(
        s,
        state.clock(),
        "admin",
        "booth.qa.cash",
        round_id=row.number,
        participant_id=body.participant_id,
        amount=body.amount,
        reason=body.reason,
    )
    s.commit()
    return {"message": "테스트 머니를 지급했습니다. 이 계좌는 랭킹·시상에서 제외됩니다."}
