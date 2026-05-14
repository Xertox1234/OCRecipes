---
title: "Toggle via transaction to prevent duplicate inserts"
track: knowledge
category: design-patterns
tags: [database, transaction, race-condition, drizzle, join-tables]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Toggle via transaction to prevent duplicate inserts

## When this applies

When implementing a toggle on a join table (favourite/unfavourite, follow/unfollow, like/unlike), wrap the check-then-write in `db.transaction()`. Without a transaction, two rapid taps can both see "not exists" and both insert, creating a duplicate row.

## Examples

The pattern is: select inside `tx`, if exists delete and return false, otherwise insert and return true.

**Defense in depth:** Combine with a unique constraint on the join table (`unique().on(table.userId, table.scannedItemId)`) so the database rejects duplicates even if transaction isolation allows a race.

## Exceptions

Idempotent operations where duplicates are harmless, or single-row updates that don't depend on a prior read.

## Related Files

- `server/storage/nutrition.ts:143` — `toggleFavouriteScannedItem()`
- `shared/schema.ts:467` — `favouriteScannedItems` table with `uniqueUserItem` constraint
- Related learning: "Toggle Favourite Race Condition" in LEARNINGS.md

## See Also

- [Unique constraint as TOCTOU safety net](unique-constraint-toctou-safety-net-2026-05-13.md)
- [Advisory lock for per-user rate limiting](advisory-lock-per-user-rate-limiting-2026-05-13.md)
