---
title: 'Toggle Favourite Race Condition: Wrap Check-Then-Write in a Transaction'
track: bug
category: logic-errors
module: server
severity: high
tags: [race-condition, transaction, drizzle, postgres, join-table, idempotency]
symptoms: [Rapid double-tap on a toggle button produces a duplicate row or 500 error, Unique constraint violation surfaces to the client instead of a clean toggle, Two concurrent requests both see 'no existing favourite' and both insert]
applies_to: [server/storage/**/*.ts]
created: '2026-02-12'
---

# Toggle Favourite Race Condition

## Problem

Without a transaction, two rapid taps on the favourite button could both see "no existing favourite" and both insert, creating a duplicate row. Even with a unique constraint, the second request failed with a database error rather than toggling gracefully.

## Symptoms

- Two rows in a "favourites" join table for one (userId, itemId) pair.
- 500 error returned to the client on the second-of-two near-simultaneous taps.
- The duplicate row breaks subsequent toggle calls because `findFirst()` is now ambiguous.

## Root Cause

Toggle endpoints follow a **check-then-write** pattern:

1. SELECT — does a favourite row exist for (userId, itemId)?
2. If yes → DELETE; if no → INSERT.

When two requests run concurrently without serialization, both reach step 1, both see "no row," and both proceed to step 2 with an INSERT. A unique constraint catches the duplicate at the DB level but surfaces as an error, not as a toggle — the user pressed a button and got a 500.

The unique constraint is **defense-in-depth, not a substitute for serialization.** It prevents corruption but does not produce correct behavior.

## Solution

Wrap the check-then-write inside a `db.transaction()` so the SELECT and the subsequent INSERT/DELETE see a consistent view:

```typescript
// ✅ Transactional toggle
export async function toggleFavouriteScannedItem(
  userId: number,
  itemId: number,
): Promise<{ favourited: boolean }> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: favouriteScannedItems.id })
      .from(favouriteScannedItems)
      .where(
        and(
          eq(favouriteScannedItems.userId, userId),
          eq(favouriteScannedItems.scannedItemId, itemId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await tx
        .delete(favouriteScannedItems)
        .where(eq(favouriteScannedItems.id, existing[0].id));
      return { favourited: false };
    }

    await tx.insert(favouriteScannedItems).values({
      userId,
      scannedItemId: itemId,
    });
    return { favourited: true };
  });
}
```

Postgres' default isolation level (`READ COMMITTED`) is sufficient here because the transaction acquires row-level locks on INSERT/DELETE, serializing concurrent toggles on the same (userId, itemId) pair.

## Prevention

- Any **check-then-write on a join table** is a toggle: follow/unfollow, like/unlike, bookmark/unbookmark, mute/unmute. Wrap in a transaction.
- The unique constraint stays — it catches every code path that forgets the transaction. Defense-in-depth.
- Add a regression test that fires two concurrent toggle calls via `Promise.all` and asserts the row count is exactly 0 or 1, never 2.

## Related Files

- `server/storage/nutrition.ts:143` — `toggleFavouriteScannedItem()`

## See Also

- [optimistic-total-target-correct-page-2026-05-13.md](optimistic-total-target-correct-page-2026-05-13.md) — Client-side companion: the same toggle UI corrupts paginated totals on the optimistic path.
- [../conventions/inline-db-transaction-over-helper-2026-05-13.md](../conventions/inline-db-transaction-over-helper-2026-05-13.md) — How to inline `db.transaction()` rather than wrapping it.
- `docs/legacy-patterns/database.md` — "Toggle via Transaction to Prevent Duplicate Inserts"
