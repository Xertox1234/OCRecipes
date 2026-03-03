---
title: "Add composite index on scannedItems for soft-delete query pattern"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [database, performance, server, pr-10-review]
---

# Add Composite Index on scannedItems for Soft-Delete Query Pattern

## Summary

Every scannedItems query now filters `WHERE userId = ? AND discardedAt IS NULL ORDER BY scannedAt DESC`, but no composite index covers this pattern. At scale (50k+ items/user), every list load becomes a sequential scan.

## Background

Current indexes on `scannedItems` (`shared/schema.ts:118-121`):
- `scanned_items_user_id_idx` on `userId`
- `scanned_items_scanned_at_idx` on `scannedAt`

The dominant query pattern (used by `getScannedItems`, `getScannedItem`, `getScannedItemWithFavourite`, `softDeleteScannedItem`, `getDailySummary`, `getDailyScanCount`, `getFavouriteScannedItems`) filters on `userId + discardedAt IS NULL + ORDER BY scannedAt DESC`. PostgreSQL must use the userId index then sequentially filter every row for discardedAt.

## Acceptance Criteria

- [ ] Composite partial index added: `(userId, scannedAt) WHERE discardedAt IS NULL`
- [ ] `db:push` runs cleanly
- [ ] Verify with `EXPLAIN ANALYZE` that the new index is used for the dominant query pattern
- [ ] All existing tests pass

## Implementation Notes

```typescript
// shared/schema.ts — scannedItems table indexes
(table) => ({
  userActiveIdx: index("scanned_items_user_active_idx")
    .on(table.userId, table.scannedAt)
    .where(sql`discarded_at IS NULL`),
  scannedAtIdx: index("scanned_items_scanned_at_idx").on(table.scannedAt),
}),
```

If Drizzle doesn't support `.where()` on indexes, fall back to a composite `(userId, discardedAt, scannedAt)` index.

Also consider adding an index on `favouriteScannedItems.scannedItemId` for the LEFT JOIN in `getScannedItems()`.

## Dependencies

- None

## Risks

- Index creation on an existing table with data will briefly lock during migration
- Partial indexes require PostgreSQL (not portable to SQLite for testing)

## Updates

### 2026-02-27
- Created from PR #10 code review (found by performance-oracle, architecture-strategist, data-integrity-guardian)
