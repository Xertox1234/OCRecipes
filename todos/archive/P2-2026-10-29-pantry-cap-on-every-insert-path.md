---
title: "Enforce the 500-item pantry cap atomically on every insert path"
status: done
priority: medium
created: 2026-10-29
updated: 2026-11-01
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Enforce the 500-item pantry cap atomically on every insert path

## Summary

The pantry cap is a count-then-insert in one route only; receipt confirm (200 items per call), grocery→pantry and batch scan never check it.

## Background

Audit finding M-data-6. `server/routes/pantry.ts` (~89-101) checks `getPantryItemCount` then inserts with no lock; `server/routes/receipt.ts` (~174 `createPantryItems`), `server/routes/grocery.ts` (~386) and `server/storage/batch.ts` (`batchCreatePantryItems`) skip it. Product decision: when a batch would cross the cap, reject it whole or add what fits.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [x] One storage function inserts pantry items under the cap inside a transaction with an advisory lock (pattern: `createGroceryListWithLimitCheck` + `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md`)
- [x] All four insert paths use it
- [x] Owner picks reject-whole vs add-what-fits for batches (owner: add what fits, 2026-10-31)
- [x] Real-DB tests: the cap holds for single, batch and concurrent inserts

## Implementation Notes

Also consider the grocery-list count cap (`server/storage/grocery-lists.ts` ~100-133), which is count-then-insert without a lock.

## Scope Contract

- **Files in scope:** `server/storage/pantry.ts`, `server/storage/batch.ts`, `server/routes/pantry.ts`, `server/routes/receipt.ts`, `server/routes/grocery.ts` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)

### 2026-10-31

- Owner decision: ADD WHAT FITS. A batch that would push the pantry past 500 items adds items up to the cap, and the response reports how many were left out (`skipped`). Reject-whole is not implemented.

### 2026-11-01

- Implemented: `createPantryItemsUnderCap` / `insertPantryItemsUnderCap` in `server/storage/pantry.ts` (advisory lock `pantry:<userId>`, count, insert what fits). Single add, receipt confirm, batch scan and grocery-to-pantry all use it. Concurrency test: `server/storage/__tests__/pantry.concurrent.test.ts`.
- Not done: grocery-list count cap lock (outside the acceptance criteria); client does not yet show `skipped`.
