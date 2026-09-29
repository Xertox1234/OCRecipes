---
title: Proactive orphan cleanup in parent delete functions
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, polymorphic-fk, junction-tables, transactions, cleanup]
applies_to: [server/storage/**/*.ts, server/scripts/**/*.ts, scripts/**/*.ts]
created: '2026-05-13'
last_updated: '2026-09-29'
---

# Proactive orphan cleanup in parent delete functions

## When this applies

When deleting a parent entity that is referenced by polymorphic junction tables (no DB-level FK), clean up **all** junction tables that reference it — not just the ones you remember. This is the "write-time" complement to the "read-time" lazy cleanup and "count-time" EXISTS subquery patterns.

This applies equally to standalone maintenance/cleanup scripts (`server/scripts/`, `scripts/`) that delete recipes directly outside the storage-layer delete functions — a script is just another "parent delete" call site, and the same junction-table checklist applies to it. See `server/scripts/cleanup-seed-recipes.ts`, `scripts/cleanup-junk-recipes.ts`, and `scripts/cleanup-junk-mealplan-recipes.ts`.

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

**Existing junction tables to check:** `cookbookRecipes`, `favouriteRecipes`, `savedItems` (added 2026-09-29 — `saved_items.recipe_id`/`recipe_type`, PR #1165). When adding a new one, update delete functions for `mealPlanRecipes`, `communityRecipes`, and any other parent table — AND every standalone cleanup script that deletes those parent tables directly.

## Why not rely solely on lazy cleanup?

Lazy cleanup (filtering orphans at read time) leaves orphaned rows in the database until someone accesses them. This inflates count queries (limit checks, profile hub counts) and wastes storage. Proactive cleanup at delete time keeps the database clean and counts accurate.

## Related Files

- `server/storage/community-recipes.ts` — `deleteCommunityRecipe()` cleans up `cookbookRecipes`, `favouriteRecipes`, `savedItems`, and `recipeDismissals`
- `server/storage/meal-plan-recipes-crud.ts` — `deleteMealPlanRecipe()` cleans up `cookbookRecipes`, `favouriteRecipes`, and `savedItems`
- `server/scripts/cleanup-seed-recipes.ts`, `scripts/cleanup-junk-recipes.ts`, `scripts/cleanup-junk-mealplan-recipes.ts` — the standalone cleanup scripts, brought in line with the storage-layer functions above (2026-09-29)
- Audit #9 M5, M6

## See Also

- [Orphan-safe counts on polymorphic junction tables](orphan-safe-counts-polymorphic-junction-tables-2026-05-13.md) (for the count-time defense)
- [Side-effect ordering around db.transaction](../conventions/side-effect-ordering-around-db-transaction-2026-05-13.md)
