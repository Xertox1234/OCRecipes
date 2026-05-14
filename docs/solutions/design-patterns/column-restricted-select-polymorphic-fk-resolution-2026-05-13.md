---
title: "Column-restricted select for polymorphic FK resolution"
track: knowledge
category: design-patterns
tags: [database, drizzle, polymorphic-fk, performance, jsonb, list-views]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# Column-restricted select for polymorphic FK resolution

## When this applies

When resolving polymorphic FK references (fetching the target rows that junction entries point to), use an explicit `.select({ ... })` with only the columns needed for display — never `.select()` (full row). Polymorphic target tables often contain large JSONB columns (`ingredients`, `instructions`) that are unnecessary for list/card views but expensive to transfer and serialize.

## Examples

```typescript
// ❌ Bad: Pulls full row including JSONB columns not used by the caller
const mealPlanResults = mealPlanIds.length
  ? await db
      .select()
      .from(mealPlanRecipes)
      .where(inArray(mealPlanRecipes.id, mealPlanIds))
  : [];

// ✅ Good: Only select columns needed for display
const mealPlanResults = mealPlanIds.length
  ? await db
      .select({
        id: mealPlanRecipes.id,
        title: mealPlanRecipes.title,
        description: mealPlanRecipes.description,
        imageUrl: mealPlanRecipes.imageUrl,
        servings: mealPlanRecipes.servings,
        difficulty: mealPlanRecipes.difficulty,
      })
      .from(mealPlanRecipes)
      .where(inArray(mealPlanRecipes.id, mealPlanIds))
  : [];
```

## When to use

Any batch resolution of polymorphic FK references where the caller renders a list/card view (favourites list, cookbook recipes, search results). These views typically need title, image, and a few metadata fields — not the full recipe body.

## Exceptions

Detail views where the caller renders the full entity (recipe detail screen, cooking session). In those cases, the full row is needed anyway.

## Why

Recipe tables often have `ingredients` (JSONB, ~2KB) and `instructions` (JSONB, ~5KB) columns. When resolving 50 favourites, pulling full rows transfers ~350KB of unused JSONB data. Column restriction reduces this to ~5KB.

## Related Files

- `server/storage/favourite-recipes.ts` — `getResolvedFavouriteRecipes()` with column-restricted select
- `server/storage/cookbooks.ts` — `getResolvedCookbookRecipes()` (similar pattern)
- Audit #9 M2

## See Also

- [Orphan-safe counts on polymorphic junction tables](orphan-safe-counts-polymorphic-junction-tables-2026-05-13.md)
- [Column-restricted SELECT + narrow Pick types for cache loaders](column-restricted-select-narrow-pick-cache-loaders-2026-05-13.md)
- [Junction table reads via innerJoin through parent](junction-table-reads-innerjoin-ownership-2026-05-13.md)
