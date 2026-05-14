---
title: "JSONB array length filtering in queries"
track: knowledge
category: conventions
tags: [database, jsonb, drizzle, sql, null-safety]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# JSONB array length filtering in queries

## Rule

When filtering rows by whether a JSONB array column has content, use `COALESCE(jsonb_array_length(...), 0)` — never bare `jsonb_array_length()`. This handles NULL values safely.

## Examples

```typescript
// Good: COALESCE guards against NULL → NULL > 0 → excluded silently
const conditions = [
  sql`COALESCE(jsonb_array_length(${table.instructions}), 0) > 0`,
];

// Bad: If column is NULL, jsonb_array_length returns NULL, and NULL > 0 is NULL (falsy)
const conditions = [sql`jsonb_array_length(${table.instructions}) > 0`];
```

For tables where content could be in a **related table** (e.g., ingredients in a separate `recipeIngredients` table), combine with an `EXISTS` subquery:

```typescript
sql`(
  COALESCE(jsonb_array_length(${mealPlanRecipes.instructions}), 0) > 0
  OR EXISTS (
    SELECT 1 FROM ${recipeIngredients}
    WHERE ${recipeIngredients.recipeId} = ${mealPlanRecipes.id}
  )
)`,
```

## When to use

Any WHERE clause that filters on JSONB array content. Even if the column is currently `NOT NULL`, schema drift or raw SQL inserts could introduce NULLs.

## Related Files

- `server/storage/community.ts` — `getFeaturedRecipes()`
- `server/storage/meal-plans.ts` — `getUnifiedRecipes()`

## See Also

- [Safe JSONB array access with Array.isArray guard](safe-jsonb-array-access-isarray-guard-2026-05-13.md)
- [Zod safeParse per JSONB element](zod-safeparse-per-jsonb-element-2026-05-13.md)
