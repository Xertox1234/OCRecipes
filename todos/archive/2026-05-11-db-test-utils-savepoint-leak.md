---
title: "db-test-utils: storage transactions leak past test rollback (top-level COMMIT bypasses outer BEGIN)"
status: backlog
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, deferred, database]
github_issue:
---

# db-test-utils: storage transactions leak past test rollback

## Summary

`test/db-test-utils.ts` returns a `drizzle(client, ...)` instance from `setupTestTransaction()`. Any storage function that calls `db.transaction()` (e.g. `submitVerification`, `confirmFrontLabelData`, `upsertProfileWithOnboarding`) issues a top-level `BEGIN/COMMIT` via Drizzle's `NodePgSession.transaction`, which commits the outer test `BEGIN` and leaks writes past `rollbackTestTransaction()`. As of this todo's creation the dev DB contains ~81,600 leaked `testuser_*` rows and ~18 leaked `barcode_verifications` rows that escaped this way.

## Background

Surfaced while implementing `todos/2026-05-11-storage-tests-critical.md` (now `todos/archive/`). Drizzle exposes two `transaction()` methods:

1. `NodePgSession.transaction()` — emits literal `BEGIN`/`COMMIT`.
2. `NodePgTransaction.transaction()` — emits `SAVEPOINT spN`/`RELEASE SAVEPOINT`.

`setupTestTransaction()` wraps a `PoolClient` after a manual `BEGIN`, but the returned `drizzle(client, ...)` is a `NodePgDatabase`, so its `.transaction()` is the session-level method. The first inner `COMMIT` ends the outer test transaction; the subsequent ROLLBACK has nothing to roll back.

The new `verification.test.ts` worked around this with per-test unique barcodes (`makeBarcode()`), but the underlying utility is still broken for any test that depends on idempotent fixture identity across runs.

## Acceptance Criteria

- [ ] `setupTestTransaction()` returns a wrapper where storage-level `db.transaction(cb)` opens a SAVEPOINT (not BEGIN/COMMIT), so all writes roll back with the outer test transaction
- [ ] A regression test in `test/db-test-utils.test.ts` (or new file) inserts via a function that calls `db.transaction()`, asserts rollback removes the row from the real DB
- [ ] Existing tests that pass today (`users.test.ts`, `nutrition.test.ts`, `verification.test.ts`, etc.) continue to pass
- [ ] `global-teardown.ts` extended to sweep stale `testuser_*` rows from `users`, plus `99*`/`000*` test fixtures from `barcode_verifications`, `verification_history`, `barcode_nutrition` — same prefix-match convention as the existing recipe sweep (L-4 audit 2026-04-17)
- [ ] One-time cleanup script (or manual SQL) deletes the ~81,600 already-leaked `testuser_*` rows and ~18 leaked `barcode_verifications`/`verification_history` rows from the dev DB

## Implementation Notes

- The simplest fix: in `setupTestTransaction()`, after `BEGIN`, call `db.transaction()` once, capture the inner `NodePgTransaction` instance, and return it from `getTestTx()`. Subsequent storage-level `db.transaction()` calls will then hit the savepoint-emitting variant. The outer `db.transaction()` callback can park on an unresolved promise and be unwound by ROLLBACK — but a simpler shape is to wrap the test body itself.
- Alternative: switch `db-test-utils.ts` to use `drizzle()` with a single Drizzle transaction's tx parameter and never expose the raw `NodePgDatabase`. This may require shifting setup/teardown into a `runInTestTransaction(callback)` helper, which changes the test API.
- The teardown sweep should match the prefix convention. Test users use `testuser_*`. Verification test barcodes use the `99*` prefix introduced by `verification.test.ts`'s `makeBarcode()`.
- Be careful with `global-teardown.ts` — broad prefix matches on `99*` could collide with real UPCs. Restrict to barcodes that don't have a matching row in any user-owned table (i.e. only orphans).

## Dependencies

None.

## Risks

- Changing how `setupTestTransaction()` returns its Drizzle instance could break tests that rely on the current behavior. Audit before merging.
- Teardown deletes against `99*` barcodes need a guard against deleting real barcodes that happen to start with 99 — gate on "no matching row in `scanned_items`, `saved_items`, etc."

## Updates

### 2026-05-11

- Created during implementation of `todos/2026-05-11-storage-tests-critical.md`
- Workaround in place: `verification.test.ts` uses `makeBarcode()` with crypto-random 13-digit barcodes prefixed `99` to avoid collisions between runs
- Leak counts confirmed: 81,600 `testuser_*` in `users`, 18 `000*` rows in `barcode_verifications` (manually cleaned before final test run)
