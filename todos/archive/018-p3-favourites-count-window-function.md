---
title: "Use window function instead of duplicate JOIN for paginated count"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [performance, database, server, pr-10-review]
---

# Use Window Function Instead of Duplicate JOIN for Paginated Count

## Summary

`getFavouriteScannedItems` runs two parallel queries with identical JOINs — one for the page of results and one for the total count. Using `count(*) OVER()` as a window function eliminates the duplicate JOIN and saves one DB round-trip per paginated request.

## Background

**File:** `server/storage/nutrition.ts` (getFavouriteScannedItems)

```typescript
const [rows, countResult] = await Promise.all([
  db.select({...}).from(favouriteScannedItems).innerJoin(scannedItems, ...).where(...).limit().offset(),
  db.select({ count }).from(favouriteScannedItems).innerJoin(scannedItems, ...).where(...),
]);
```

The same optimization applies to `getScannedItems()` which also runs two parallel queries with overlapping JOINs.

## Acceptance Criteria

- [ ] `getFavouriteScannedItems` uses `count(*) OVER()` window function
- [ ] `getScannedItems` uses `count(*) OVER()` window function
- [ ] Single query per paginated request instead of two
- [ ] ~30-40% latency improvement on paginated list endpoints
- [ ] Total count still correctly returned in API response
- [ ] All existing tests pass

## Implementation Notes

```typescript
const rows = await db
  .select({
    item: scannedItems,
    favouriteId: favouriteScannedItems.id,
    total: sql<number>`count(*) OVER()`,
  })
  .from(favouriteScannedItems)
  .innerJoin(scannedItems, eq(favouriteScannedItems.scannedItemId, scannedItems.id))
  .where(...)
  .orderBy(desc(favouriteScannedItems.createdAt))
  .limit(limit)
  .offset(offset);

const total = rows.length > 0 ? rows[0].total : 0;
```

## Dependencies

- None

## Risks

- Window functions add slight overhead per row, but this is negligible compared to eliminating a full duplicate query
- Verify Drizzle ORM correctly types the window function result

## Updates

### 2026-02-27
- Created from PR #10 code review (found by performance-oracle)
