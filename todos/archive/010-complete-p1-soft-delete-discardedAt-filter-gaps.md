---
title: "Add missing discardedAt filters to 3 queries"
status: done
priority: critical
created: 2026-02-27
updated: 2026-03-02
assignee:
labels: [data-integrity, database, server, pr-10-review]
---

# Add Missing discardedAt Filters to 3 Queries

## Summary

PR #10 introduced soft delete via `discardedAt` on `scannedItems` but missed filtering it in 3 queries. This causes inflated counts and discarded items leaking into meal plan responses — the exact bug class documented in `docs/LEARNINGS.md`.

## Affected Queries

### 1. `getDailyScanCount()` — CRITICAL

**File:** `server/storage/nutrition.ts:305-323`

Counts daily scans but includes soft-deleted items. Inflates dashboard "items scanned" count and potentially breaks rate limiting.

```typescript
// MISSING: isNull(scannedItems.discardedAt) in WHERE clause
const result = await db
  .select({ count: sql<number>`count(*)` })
  .from(scannedItems)
  .where(
    and(
      eq(scannedItems.userId, userId),
      gte(scannedItems.scannedAt, startOfDay),
      lt(scannedItems.scannedAt, endOfDay),
      // ADD: isNull(scannedItems.discardedAt),
    ),
  );
```

### 2. `getMealPlanItemsForDate()` batch lookup

**File:** `server/storage/meal-plans.ts:269-278`

Fetches scanned items by ID list without excluding discarded items. Discarded items appear in meal plan responses.

### 3. `getMealPlanItemById()` single lookup

**File:** `server/storage/meal-plans.ts:317-322`

Same issue for single item fetch.

## Acceptance Criteria

- [x] `getDailyScanCount()` filters `isNull(scannedItems.discardedAt)`
- [x] `getMealPlanItemsForDate()` batch lookup filters `isNull(scannedItems.discardedAt)`
- [x] `getMealPlanItemById()` single lookup filters `isNull(scannedItems.discardedAt)`
- [x] All existing tests pass
- [x] Add test cases verifying discarded items are excluded from each query

## Implementation Notes

One-line fix per query — add `isNull(scannedItems.discardedAt)` to each WHERE clause. For meal-plans queries, if the intent is to keep discarded items visible in meal plan context, add an explicit code comment explaining why.

## Dependencies

- None

## Risks

- Meal plan items referencing discarded scanned items will lose their enrichment data. If this is undesirable, the meal-plan queries should be left as-is with an explanatory comment.

## Updates

### 2026-02-27
- Created from PR #10 code review (found by security-sentinel, performance-oracle, data-integrity-guardian)

### 2026-03-02
- Resolved: Added `isNull(scannedItems.discardedAt)` to all 3 queries
- Added `isNull` import to meal-plans.ts (already existed in nutrition.ts)
- Added 3 test cases: 1 for getDailyScanCount, 1 for getMealPlanItems, 1 for getMealPlanItemById
- All 2381 tests pass
