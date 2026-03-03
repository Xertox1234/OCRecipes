---
title: "Clean up orphaned favourite rows for soft-deleted items"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [data-integrity, database, server, pr-10-review]
---

# Clean Up Orphaned Favourite Rows for Soft-Deleted Items

## Summary

When a scanned item is soft-deleted, its favourite rows in `favouriteScannedItems` remain. They're functionally hidden (INNER JOIN filters them), but they accumulate indefinitely and would reappear if an item were ever "un-discarded."

## Background

`softDeleteScannedItem()` sets `discardedAt` but does not remove corresponding favourite rows. The `getFavouriteScannedItems` query correctly hides them via the INNER JOIN with `isNull(scannedItems.discardedAt)`, so this is not a data leakage issue — just dangling data.

## Acceptance Criteria

- [ ] Favourite rows deleted when a scanned item is soft-deleted (in the same transaction)
- [ ] OR: periodic cleanup job for orphaned favourites
- [ ] No orphaned favourite rows accumulate over time
- [ ] All existing tests pass

## Implementation Notes

### Option A: Clean up during soft delete (preferred)

```typescript
async softDeleteScannedItem(id: number, userId: string) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(scannedItems)
      .set({ discardedAt: new Date() })
      .where(and(eq(scannedItems.id, id), eq(scannedItems.userId, userId), isNull(scannedItems.discardedAt)))
      .returning();

    if (updated) {
      await tx.delete(favouriteScannedItems)
        .where(eq(favouriteScannedItems.scannedItemId, id));
    }

    return !!updated;
  });
}
```

### Option B: Periodic cleanup

```sql
DELETE FROM favourite_scanned_items
WHERE scanned_item_id IN (
  SELECT id FROM scanned_items WHERE discarded_at IS NOT NULL
);
```

## Dependencies

- None

## Risks

- Option A: If "un-discard" is ever implemented, favourite state would be lost
- Option B: Requires scheduling infrastructure (cron job or similar)

## Updates

### 2026-02-27
- Created from PR #10 code review (found by data-integrity-guardian)
