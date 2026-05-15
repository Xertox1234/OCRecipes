---
title: "Extract direct db.transaction calls from routes into storage layer"
status: complete
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: M7
---

# Extract direct db.transaction calls from routes into storage layer

## Summary

6 route files (`nutrition.ts`, `photos.ts`, `cooking.ts`, `beverages.ts`, `profile.ts`, `meal-plan.ts`) import `db` directly and perform raw Drizzle transactions, bypassing the storage abstraction.

## Background

All 6 routes perform the same pattern: `db.transaction(tx => { insert scannedItems + insert dailyLogs })`. This "create-scanned-item-with-daily-log" transaction should be a single storage function.

## Acceptance Criteria

- [ ] `createScannedItemWithLog` (or similar) storage function created
- [ ] All 6 routes use the new storage function instead of direct `db` access
- [ ] No route files import from `../db` (except test files)
- [ ] Existing tests pass

## Implementation Notes

- The storage function goes in `server/storage/nutrition.ts` or a new `server/storage/daily-logs.ts`
- Each route's transaction is slightly different — may need a flexible parameter interface

## Dependencies

- None

## Risks

- Need to verify each route's transaction does exactly the same thing before extracting

## Updates

### 2026-03-27

- Created from full audit finding M7

### 2026-04-02

- Resolved by full audit finding H4: nutrition-lookup.ts and meal-type-inference.ts now use storage layer instead of direct DB imports
