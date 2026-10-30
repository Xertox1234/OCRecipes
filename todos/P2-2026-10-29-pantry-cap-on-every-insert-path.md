---
title: "Enforce the 500-item pantry cap atomically on every insert path"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
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

- [ ] One storage function inserts pantry items under the cap inside a transaction with an advisory lock (pattern: `createGroceryListWithLimitCheck` + `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md`)
- [ ] All four insert paths use it
- [ ] Owner picks reject-whole vs add-what-fits for batches
- [ ] Real-DB tests: the cap holds for single, batch and concurrent inserts

## Implementation Notes

Also consider the grocery-list count cap (`server/storage/grocery-lists.ts` ~100-133), which is count-then-insert without a lock.

## Scope Contract

- **Files in scope:** `server/storage/pantry.ts`, `server/storage/batch.ts`, `server/routes/pantry.ts`, `server/routes/receipt.ts`, `server/routes/grocery.ts` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
