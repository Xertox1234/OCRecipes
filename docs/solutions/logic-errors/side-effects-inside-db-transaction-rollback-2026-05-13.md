---
title: Side Effects Inside db.transaction Silently Desync State on Rollback
track: bug
category: logic-errors
module: server
severity: high
tags: [database, transactions, search-index, side-effects, data-integrity]
symptoms: [Search index missing entries that still exist in the database, Stale entries linger until server restart re-runs `initSearchIndex`, Bug only surfaces when a transaction rolls back after a side effect already fired]
applies_to: [server/storage/**/*.ts]
created: '2026-04-17'
---

# Side Effects Inside db.transaction Silently Desync State on Rollback

## Problem

`deleteMealPlanRecipe` and `deleteCommunityRecipe` fired `removeFromIndex(id)` INSIDE their `db.transaction(async tx => ...)` callbacks, before the transaction committed. If the transaction later rolled back (post-delete junction cleanup threw, serialization conflict, timeout), the recipe was restored in the DB — but the MiniSearch index had already forgotten it. The index returned stale results until the server restarted and re-ran `initSearchIndex`.

## Symptoms

- Recipe is present in the DB but missing from search results
- Issue persists across requests until server restart
- No transaction-error log because the side effect succeeded before the rollback

## Root Cause

External-state mutations inside a transaction callback execute immediately and unconditionally. The transaction's commit/rollback decision happens after the callback returns. A rollback restores DB rows but cannot undo a `removeFromIndex` (or any other side effect — pub/sub, metrics emission, in-memory cache write). The data-store and the side-effect target diverge silently.

The inverse failure mode — crashing between `COMMIT` and `removeFromIndex` — leaves a stale entry pointing to a deleted row. That is strictly better: stale-in-index is self-healing on the next `initSearchIndex` (reads from DB), whereas rollback corruption is permanent until restart AND can leak deleted-but-still-cached data to other users.

## Solution

Move the external mutation OUTSIDE the transaction, gated on whether the transaction actually succeeded:

```typescript
// Wrong
return db.transaction(async (tx) => {
  await tx.delete(x).where(...);
  removeFromIndex(id); // fires even if tx rolls back
  await tx.delete(junction).where(...);
});

// Right
const deleted = await db.transaction(async (tx) => {
  const [row] = await tx.delete(x).where(...).returning(...);
  if (!row) return false;
  await tx.delete(junction).where(...);
  return true;
});
if (deleted) removeFromIndex(id);
return deleted;
```

## Prevention

- Any external-state mutation (search index, in-memory cache, pub/sub, metrics, webhook) MUST fire AFTER `db.transaction` resolves, gated on success.
- Prefer "stale-in-cache" over "missing-from-cache" — the former is self-healing on the next refresh, the latter requires a restart.
- Audit transaction callbacks for non-`tx.` calls; any function name that does not start with the transaction handle is a candidate for ordering review.

## Related Files

- `server/storage/meal-plans.ts` — `deleteMealPlanRecipe` (fixed)
- `server/storage/community.ts` — `deleteCommunityRecipe` (fixed)
- `docs/legacy-patterns/database.md` — "Side-Effect Ordering Around `db.transaction`"

## See Also

- [Side-effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
- [Transactions in storage layer](../conventions/transactions-in-storage-layer-2026-05-13.md)
