---
title: Column-restricted SELECT + narrow Pick types for cache loaders
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, performance, typescript, cache, jsonb]
applies_to: [server/storage/**/*.ts, server/lib/**/*.ts]
created: '2026-05-13'
---

# Column-restricted SELECT + narrow Pick types for cache loaders

## When this applies

When a storage function loads rows to populate an in-memory cache/index, project only the columns the cache consumes — never `SELECT *` on tables with JSONB columns. Declare a narrow `Pick<>` type co-located with the consumer.

## Examples

```typescript
// ❌ Bad: loads all rows including heavy `instructions` JSONB
export async function getAllMealPlanRecipes(): Promise<MealPlanRecipe[]> {
  return db
    .select()
    .from(mealPlanRecipes)
    .orderBy(desc(mealPlanRecipes.createdAt));
}
```

```typescript
// ✅ Good: narrow type declares what the index actually reads
export type SearchIndexableMealPlanRecipe = Pick<
  MealPlanRecipe,
  | "id"
  | "userId"
  | "title"
  | "description"
  | "cuisine"
  | "dietTags"
  | "mealTypes"
  | "difficulty"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "servings"
  | "imageUrl"
  | "sourceUrl"
  | "createdAt"
>;

export async function getAllMealPlanRecipes(): Promise<
  SearchIndexableMealPlanRecipe[]
> {
  return db
    .select({
      id: mealPlanRecipes.id,
      userId: mealPlanRecipes.userId,
      title: mealPlanRecipes.title,
      // ... only the columns the index reads; JSONB `instructions` omitted
    })
    .from(mealPlanRecipes)
    .orderBy(desc(mealPlanRecipes.createdAt));
}
```

## Why

JSONB columns (recipe `instructions`, ingredient arrays, etc.) can be 5–50 KB per row. Index loaders scan the whole table; at N users × M recipes the memory and DB transfer dominate startup cost linearly. Projection saves N× the JSONB size.

## Pattern placement

The `Search/Cache/Index`-able narrow type lives next to the loader (or in a shared `server/lib/` module if both storage and service need it), **not** in `shared/schema.ts`.

**Origin:** 2026-04-17 audit H5 — `getAllMealPlanRecipes` / `getAllPublicCommunityRecipes` / `getAllRecipeIngredients` were loading entire rows into the MiniSearch index which only consumes title + ingredient names + a few scalars.

## See Also

- [Column-restricted select for polymorphic FK resolution](column-restricted-select-polymorphic-fk-resolution-2026-05-13.md)
