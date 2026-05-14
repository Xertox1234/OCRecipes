---
title: "Proactive orphan cleanup in parent delete functions"
track: knowledge
category: design-patterns
tags:
  [database, drizzle, polymorphic-fk, junction-tables, transactions, cleanup]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Proactive orphan cleanup in parent delete functions

## When this applies

When deleting a parent entity that is referenced by polymorphic junction tables (no DB-level FK), clean up **all** junction tables that reference it — not just the ones you remember. This is the "write-time" complement to the "read-time" lazy cleanup and "count-time" EXISTS subquery patterns.

## Examples

```typescript
// ❌ Bad: Only cleans up cookbookRecipes, forgets favouriteRecipes
export async function deleteCommunityRecipe(recipeId: number, userId: string) {
  return db.transaction(async (tx) => {
    await tx
      .delete(cookbookRecipes)
      .where(
        and(
          eq(cookbookRecipes.recipeId, recipeId),
          eq(cookbookRecipes.recipeType, "community"),
        ),
      );
    await tx
      .delete(communityRecipes)
      .where(
        and(
          eq(communityRecipes.id, recipeId),
          eq(communityRecipes.authorId, userId),
        ),
      );
  });
}

// ✅ Good: Cleans up ALL junction tables referencing this entity
export async function deleteCommunityRecipe(recipeId: number, userId: string) {
  return db.transaction(async (tx) => {
    await Promise.all([
      tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, recipeId),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        ),
      tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.recipeId, recipeId),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        ),
    ]);
    await tx
      .delete(communityRecipes)
      .where(
        and(
          eq(communityRecipes.id, recipeId),
          eq(communityRecipes.authorId, userId),
        ),
      );
  });
}
```

## Checklist

When adding a new polymorphic junction table: Find every `delete` function for every parent table type and add cleanup for the new junction table. Use `Promise.all` for independent cleanup queries within the same transaction.

**Existing junction tables to check:** `cookbookRecipes`, `favouriteRecipes`. When adding a third (e.g., `sharedRecipes`), update delete functions for `mealPlanRecipes`, `communityRecipes`, and any other parent table.

## Why not rely solely on lazy cleanup?

Lazy cleanup (filtering orphans at read time) leaves orphaned rows in the database until someone accesses them. This inflates count queries (limit checks, profile hub counts) and wastes storage. Proactive cleanup at delete time keeps the database clean and counts accurate.

## Related Files

- `server/storage/community.ts` — `deleteCommunityRecipe()` cleans up both `cookbookRecipes` and `favouriteRecipes`
- `server/storage/meal-plans.ts` — `deleteMealPlanRecipe()` cleans up both junction tables
- Audit #9 M5, M6

## See Also

- [Orphan-safe counts on polymorphic junction tables](orphan-safe-counts-polymorphic-junction-tables-2026-05-13.md) (for the count-time defense)
- [Side-effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
