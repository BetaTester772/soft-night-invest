# Booth admin opening and cash grants

**Goal:** Add immediate market opening and an amount entered by the administrator for one selected participant.

**Approach:** Extend existing FastAPI admin routes and React admin controls. Keep round locking, audit trails and existing scheduler behavior. Work in the current checkout to retain the user's in-progress UI changes; leave the pre-existing unresolved design document untouched.

## Behavior

- Open a pending round now for its original 50-minute duration, without changing other rounds. Reject overlapping sessions and reopening an initialized round. Use stored session times for trading and enrollment.
- Grant 1–1,000,000,000 whole won to a selected participant's existing non-disqualified account before closing, requiring a reason. Persist a request key so a retry cannot credit twice.
- Treat grants as additional principal for portfolio returns and ranking, preserving the existing first-trade eligibility rules. Preserve balances and holdings when opening.

## Tasks

- [x] Add API integration tests for opening outside the scheduled date, scheduling/ticks/pause/close, overlaps, authorization, cash grants, invalid input, retries and returns/ranking.
- [x] Implement opening, grant ledger and migration, stored-time validation, and return calculations.
- [x] Test and add admin buttons, amount input, balance display and retry key handling.
- [x] Document API and operating behavior. Run backend/frontend checks and migration checks; review the final diff.

## PR integration

- Rebased changes onto the latest main, preserving registered login, QA-cash disqualification, optimized ranking projections and account-level trade locking.
- Cash-grant migration follows login migration 0013 as revision 0014.
- New controls and messages follow the existing Korean/English localization system.
- The original checkout, unrelated display changes and its unresolved design document remain untouched.

## PR verification

- Backend: 432 passed, 21 configured-environment tests skipped; ruff lint/format and strict mypy passed.
- Frontend: 197 tests passed; TypeScript and production build passed.
- Migration 0013 → 0014 → 0013 → 0014 and metadata comparisons passed in an isolated SQLite database; PostgreSQL-specific checks remain for CI.
- Independent integration review found no blocking logic defects. The missing English amount label was reproduced by a failing UI test, translated, and verified by the green full suite.
- Registered signup was tested after the original event end, including the following date; signup closes at the moved round close.
