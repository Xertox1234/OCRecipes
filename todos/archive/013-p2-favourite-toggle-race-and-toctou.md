---
title: "Fix TOCTOU gap and race condition in favourite toggle"
status: backlog
priority: medium
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [data-integrity, server, concurrency, pr-10-review]
---

# Fix TOCTOU Gap and Race Condition in Favourite Toggle

## Summary

The favourite toggle route has two concurrency issues: (1) a TOCTOU gap where the item can be soft-deleted between the ownership check and the toggle, and (2) the transaction under READ COMMITTED doesn't gracefully handle concurrent toggles — the unique constraint catches duplicates but surfaces as an unhandled 500.

## Issue 1: TOCTOU Gap

**File:** `server/routes/nutrition.ts` (favourite toggle route)

The route checks ownership outside the transaction, then toggles inside it:
```typescript
// Step 1: Check ownership (NOT in transaction)
const item = await storage.getScannedItem(id);
if (!item || item.userId !== req.userId) { return 404; }

// Step 2: Toggle (in transaction)
const isFavourited = await storage.toggleFavouriteScannedItem(id, req.userId!);
```

Between steps 1 and 2, a concurrent request could soft-delete the item. The toggle would create a favourite pointing to a discarded item.

**Fix:** Move ownership + discardedAt check inside the toggle transaction.

## Issue 2: Concurrent Toggle Race

**File:** `server/storage/nutrition.ts:143-168`

Under PostgreSQL READ COMMITTED, two concurrent toggles can both read "no favourite" and both attempt to insert. The unique constraint catches it, but the error surfaces as 500 instead of a graceful toggle.

**Fix:** Catch PostgreSQL error code `23505` (unique violation) in the transaction and treat it as "already favourited, toggle off."

## Acceptance Criteria

- [ ] Ownership check moved inside the toggle transaction
- [ ] Unique constraint violation caught and handled gracefully (retry as unfavourite)
- [ ] No 500 errors on concurrent rapid taps
- [ ] Soft-deleted items cannot be favourited
- [ ] All existing tests pass
- [ ] Add test for concurrent toggle scenario

## Implementation Notes

```typescript
async toggleFavouriteScannedItem(scannedItemId: number, userId: string): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    // Verify item is active + owned (inside transaction)
    const [item] = await tx.select({ id: scannedItems.id })
      .from(scannedItems)
      .where(and(
        eq(scannedItems.id, scannedItemId),
        eq(scannedItems.userId, userId),
        isNull(scannedItems.discardedAt),
      ));
    if (!item) return null; // item not found or not owned

    const [existing] = await tx.select()
      .from(favouriteScannedItems)
      .where(and(
        eq(favouriteScannedItems.scannedItemId, scannedItemId),
        eq(favouriteScannedItems.userId, userId),
      ));

    if (existing) {
      await tx.delete(favouriteScannedItems).where(eq(favouriteScannedItems.id, existing.id));
      return false;
    }

    try {
      await tx.insert(favouriteScannedItems).values({ userId, scannedItemId });
      return true;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        // Concurrent insert — treat as already favourited, toggle off
        await tx.delete(favouriteScannedItems).where(and(
          eq(favouriteScannedItems.scannedItemId, scannedItemId),
          eq(favouriteScannedItems.userId, userId),
        ));
        return false;
      }
      throw err;
    }
  });
}
```

This also eliminates one DB round-trip (the separate ownership check query).

## Dependencies

- None

## Risks

- Changing the storage method signature (returning `null` for not-found) requires updating the route handler
- Low probability of concurrent toggles in practice, but worth fixing for correctness

## Updates

### 2026-02-27
- Created from PR #10 code review (found by data-integrity-guardian, security-sentinel, performance-oracle)
