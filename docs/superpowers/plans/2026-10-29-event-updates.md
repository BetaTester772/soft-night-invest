# Booth event updates implementation plan

**Goal:** Add automatic news, update the KST sessions, complete English registration, and expose production administrator opening and cash grants.
**Architecture:** Extend the existing FastAPI scheduler and React translation catalog; preserve registered identities, round/account locking, QA cash exclusion and existing balances.
**Tech stack:** Python, SQLAlchemy/Alembic, React, TypeScript, Vitest, pytest.
**Spec:** User request in this conversation, including the clarified automatic-news requirement.

## Decisions
- Three 50-minute sessions: 17:00–17:50, 18:30–19:20, 19:30–20:20 KST. Display dinner break between sessions one and two. Migrate only untouched pending rounds on the old schedule; preserve initialized rounds.
- Publish varied dinosaur-themed market commentary every two minutes based on the actual sector movement. Commentary does not move prices; existing ghost and meteor events keep their effects.
- Translate registration labels, hints, validation, privacy consent, verification feedback and success messages. Keep user names and operator-authored headlines intact.
- Verify administrator controls already merged in latest main: open a pending session now for 50 minutes with overlap protection; grant 1–1,000,000,000 won with a reason and retry key. Include grants in principal and compare returns fairly. Preserve the existing QA cash tool and its ranking exclusion.
- Use an independent temporary checkout because the source checkout has unresolved stashed changes and its Git metadata is read-only. Deliver a reviewable commit/patch without overwriting that checkout.

## Tasks
- [x] Add failing regression tests for new time boundaries, persisted schedules, automatic news, English registration and administrator controls.
- [x] Implement schedule and administrator endpoints, grant ledger, migration, principal-aware rankings and news generation.
- [x] Implement translated registration, dinner-break display and administrator controls; keep existing login English regression coverage.
- [x] Run full suites, typing/lint/build and migration round-trip; review the combined change and deliver the branch.

## Review focus
- Existing initialized rounds and participant holdings must survive schedule migration and manual opening.
- Retried grants must not double credit; QA grants remain excluded from awards.
- News must describe actual direction, remain idempotent and have no additional price effect.
- English validation and email-code feedback must update on language switches.
- Opening overlap, close boundaries and dinner break must be consistent between API and UI.

## Integration notes
- GitHub main advanced beyond the stale local tracking ref. Restored the exact main commit 1256a7e and its tree through the GitHub connector, preserving the already-merged administrator feature and its fixes.
- Existing administrator cash grants remain migration 0014. This task adds schedule migration 0015 without rewriting history.

## Verification
- Backend: 439 passed, 21 configured-environment tests skipped; ruff lint/format and strict mypy passed.
- Frontend: 216 passed; TypeScript and production build passed. Existing empty VITE_SITE_URL warning remains.
- Alembic: 0014 → 0015 → 0014 → 0015 and metadata comparisons passed on an isolated SQLite database. Schedule migration tests cover pending/open/closed and custom times. PostgreSQL-specific checks require CI.
- Independent review found one untranslated registration footer; regression assertions reproduced the failure, the footer was translated, and the registration suite passed. No remaining blocking findings.
