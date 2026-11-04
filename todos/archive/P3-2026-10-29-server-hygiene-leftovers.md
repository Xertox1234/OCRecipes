---
title: "Server leftovers: background work in registerRoutes, verification aggregates, script AI parsing, coach log rows"
status: done
priority: low
created: 2026-10-29
updated: 2026-10-31
assignee:
labels: [deferred, server]
github_issue:
---

# Server leftovers: background work in registerRoutes, verification aggregates, script AI parsing, coach log rows

## Summary

Small server items from the pre-launch audit.

## Background

Audit findings L-arch-2 — `server/routes.ts` (~116-122) starts `initSearchIndex()` and `startNotificationScheduler()` inside `registerRoutes`, so any test/script that registers routes starts them; move to `server/index.ts` and let shutdown stop the scheduler. L-data-9 — `barcode_verifications` aggregates are not recomputed after a deleted user's `verification_history` cascades; `scanned_items` fiber/sugar/sodium lack `>= 0` CHECKs. L-cq-2 — `server/scripts/seed-recipes.ts` (~369-372) and `backfill-community-nutrition.ts` (~62) parse AI JSON without Zod (fails safe). L-sec-10 follow-up — the coach's `get_daily_log_details` (`server/services/coach-tools.ts` ~600) returns log rows unfiltered; check whether product names there come from external sources and sanitize like get_meal_plan.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [x] Background work starts from server/index.ts; registerRoutes has no side effects
- [x] Verification aggregates are recomputed (or documented as accepted) on user deletion; CHECKs added via a migration
- [x] Script AI output is Zod-parsed
- [x] get_daily_log_details sanitizes third-party names if it carries any

## Implementation Notes

The CHECK constraints need a migration — verify on prod before merge.

## Scope Contract

- **Files in scope:** `server/routes.ts`, `server/index.ts`, `server/storage/verification.ts`, `shared/schema.ts` + migration, `server/scripts/seed-recipes.ts`, `server/scripts/backfill-community-nutrition.ts`, `server/services/coach-tools.ts` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Decision: RECOMPUTE the `barcode_verifications` aggregates on user deletion (not accept-and-document).

### 2026-11-01

- Background work (`initSearchIndex`, `startNotificationScheduler`) moved from `registerRoutes` to `server/index.ts`; `shutdown()` now calls `stopNotificationScheduler()`.
- `deleteUser` recomputes the level/count/consensus of every barcode the deleted user voted on (`recomputeAggregatesForBarcodes` in `server/storage/verification.ts`, same advisory lock as `submitVerification`).
- `scanned_items` fiber/sugar/sodium `>= 0` CHECKs added in `shared/schema.ts` + `migrations/0036_scanned_items_micro_gte0.sql` (prod apply pending, owner).
- Both scripts now Zod-parse the AI macro estimate.
- `get_daily_log_details` returns `daily_logs` rows, which hold only ids, numbers, `source`, `mealType` and timestamps. No product or recipe name is carried, so there is nothing third-party to sanitize; no code change.
