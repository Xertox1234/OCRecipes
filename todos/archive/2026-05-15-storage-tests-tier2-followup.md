---
title: "Tier 2 follow-up: tests for 9 remaining untested storage modules"
status: in-progress
priority: medium
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# Tier 2 follow-up: tests for 9 remaining untested storage modules

## Summary

Carries forward the Tier 2 acceptance items from `todos/archive/2026-05-11-storage-tests-medium.md` that were intentionally deferred to keep that PR reviewable. Tier 1 (`cookbooks.test.ts`, `reformulation.test.ts`) and the already-existing `carousel.test.ts` were completed in that PR.

## Background

The audit-2026-05-11 testing finding flagged 12 storage modules with zero coverage. Bundling all 12 into one PR was unreviewable (~1500 LOC of source to cover; one module — `meal-plan-recipes.ts` — is 554 LOC on its own). This todo splits the remaining 9 out so they can be picked up individually or in small batches.

## Acceptance Criteria

- [x] `server/storage/__tests__/receipt.test.ts` (42 LOC source — small, fast)
- [x] `server/storage/__tests__/recipe-from-chat.test.ts` — `saveRecipeFromChat` lineage tracking (referenced in audit 2026-05-09 changelog)
- [x] `server/storage/__tests__/reminders.test.ts` (88 LOC source)
- [x] `server/storage/__tests__/batch.test.ts` (166 LOC source)
- [x] `server/storage/__tests__/meal-plan-recipes.test.ts` — split into `todos/2026-05-15-meal-plan-recipes-tests.md` (554 LOC source; parent line flagged the split as likely needed, and 8 other test files already make this PR sizeable)
- [x] `server/storage/__tests__/meal-plan-items.test.ts` (197 LOC source)
- [x] `server/storage/__tests__/meal-plan-analytics.test.ts` (255 LOC source)
- [x] `server/storage/__tests__/push-tokens.test.ts` (55 LOC source — small)
- [x] `server/storage/__tests__/profile-hub.test.ts` (73 LOC source — small)

## Implementation Notes

- Reuse the transaction-rollback pattern from existing storage tests; the canonical template is `server/storage/__tests__/favourite-recipes.test.ts` (transaction setup, db mock, fire-and-forget mock).
- For storage functions that internally call `db.transaction()` (e.g. anything that takes pg advisory locks or does multi-step writes), follow the per-test unique-id pattern from `server/storage/__tests__/verification.test.ts` to sidestep the documented test-tx leak in `todos/2026-05-11-db-test-utils-savepoint-leak.md`.
- Many of these modules are simple wrappers; happy-path + one negative case is sufficient per export.
- Tests may surface latent bugs (as `cookbooks.test.ts` did with the `${column}` parameterization bug — see `docs/LEARNINGS.md`). Fix surgical bugs inline; defer non-surgical refactors via a new todo.

## Dependencies

- None (storage modules already have production usage).

## Risks

- Low — these are storage modules in active production. Tests will surface latent bugs but probably not block anything user-facing.

## Updates

### 2026-05-15

- Created from the Tier 2 leftovers of `todos/archive/2026-05-11-storage-tests-medium.md`.
- Added the 8 small/medium test files. The 554-LOC `meal-plan-recipes.ts` test was split into `todos/2026-05-15-meal-plan-recipes-tests.md` per the parent acceptance line's own caveat, to keep this PR reviewable. The 8 files added ~75 tests via the transaction-rollback + per-test-unique-id patterns; no source code under test was modified.
