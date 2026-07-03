---
title: Orphan-safe counts on polymorphic junction tables
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, sql, polymorphic-fk, junction-tables, exists]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Orphan-safe counts on polymorphic junction tables

## When this applies

When counting rows in a polymorphic junction table (no DB-level FK), a simple `LEFT JOIN + count` inflates the result because deleted parent rows leave orphaned junction entries. Use EXISTS subqueries to count only rows whose targets still exist.

## Examples

```typescript
// ❌ Bad: counts orphaned junction rows where target recipe was deleted
const rows = await db
  .select({ recipeCount: count(cookbookRecipes.id) })
  .from(cookbooks)
  .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
  .groupBy(cookbooks.id);

// ✅ Good: EXISTS subquery verifies each target exists
const recipeCountSql = sql<number>`(
  SELECT count(*) FROM ${cookbookRecipes} cr
  WHERE cr.cookbook_id = ${cookbooks.id}
  AND (
    (cr.recipe_type = 'mealPlan' AND EXISTS (
      SELECT 1 FROM ${mealPlanRecipes} WHERE ${mealPlanRecipes.id} = cr.recipe_id
    ))
    OR
    (cr.recipe_type = 'community' AND EXISTS (
      SELECT 1 FROM ${communityRecipes} WHERE ${communityRecipes.id} = cr.recipe_id
    ))
  )
)`;
```

## When to use

Any aggregation (count, sum) on a junction table where the FK is application-enforced (polymorphic `recipeId` + `recipeType` discriminator) rather than DB-enforced.

## Why not just rely on eager orphan cleanup?

Orphan cleanup runs on detail-view access (`getResolvedCookbookRecipes`), so list views show stale counts until the user opens the detail. The EXISTS approach gives accurate counts without requiring prior cleanup.

## Related Files

- `server/storage/cookbooks.ts` — `getUserCookbooks()`
- Audit #6 H5

## See Also

- [Column-restricted select for polymorphic FK resolution](column-restricted-select-polymorphic-fk-resolution-2026-05-13.md)
- [Proactive orphan cleanup in parent delete functions](proactive-orphan-cleanup-parent-delete-functions-2026-05-13.md)
