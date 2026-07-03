---
title: Side-effect ordering around db.transaction
track: knowledge
category: conventions
module: server
tags: [database, transaction, drizzle, cache, side-effects, consistency]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Side-effect ordering around db.transaction

## Rule

External-state mutations (search-index updates, in-memory caches, pub/sub notifications) **must fire AFTER `db.transaction` resolves**, not inside the transaction callback. Side effects inside the callback run before commit — if the transaction rolls back (serialization failure, constraint violation, post-delete junction-cleanup error), the external state is silently desynced from the DB, and the desync persists until process restart.

## Examples

```typescript
// ❌ Bad: index mutation runs before commit; rollback silently poisons the cache
export async function deleteMealPlanRecipe(id: number, userId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(mealPlanRecipes).where(...).returning(...);
    if (!row) return false;

    removeFromIndex(`personal:${id}`); // fires BEFORE commit
    await tx.delete(cookbookRecipes).where(...); // if this throws, tx rolls back
    return true;
  });
}
```

```typescript
// ✅ Good: capture the transaction result, fire side effects post-commit
export async function deleteMealPlanRecipe(id: number, userId: string) {
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx.delete(mealPlanRecipes).where(...).returning(...);
    if (!row) return false;
    await tx.delete(cookbookRecipes).where(...);
    return true;
  });

  // Post-commit side effects — only fire if the transaction actually succeeded
  if (deleted) removeFromIndex(`personal:${id}`);
  return deleted;
}
```

## Why

The inverted failure mode — "crash between commit and side effect leaves stale cache entry" — is strictly better than "rollback silently removes an entry from the cache that still exists in the DB." The stale entry is self-healing on next process init; the rollback corruption is permanent until restart AND can leak deleted-but-still-cached data to other users.

## Applies to

MiniSearch index mutations, `fireAndForget` cache pokes, external service notifications, metrics emissions — any write that touches state outside the database.

**Origin:** 2026-04-17 audit H6 — `removeFromIndex` was firing inside `db.transaction` callbacks in `deleteMealPlanRecipe` / `deleteCommunityRecipe`.

## See Also

- [Fire-and-forget for non-critical background operations](../design-patterns/fire-and-forget-non-critical-background-2026-05-13.md)
- [Proactive orphan cleanup in parent delete functions](../design-patterns/proactive-orphan-cleanup-parent-delete-functions-2026-05-13.md)
- [Batch UPDATE via UPDATE … FROM (VALUES …)](../design-patterns/batch-update-via-update-from-values-2026-05-13.md)
