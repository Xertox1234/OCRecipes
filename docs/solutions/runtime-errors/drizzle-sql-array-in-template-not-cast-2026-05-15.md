---
title: "Drizzle sql template serializes JavaScript array as scalar bound parameter in ANY()"
track: bug
category: runtime-errors
tags: [drizzle, sql-template, postgresql, array, in-array]
module: server
applies_to: ["server/storage/**/*.ts"]
symptoms:
  - "PostgreSQL error: malformed array literal"
  - "PostgreSQL error: op ANY/ALL (array) requires array on right side"
  - "Failure only appears when the JavaScript array is non-empty"
  - "Silent success when the table is empty due to an earlier length guard"
created: 2026-05-15
severity: high
---

# Drizzle sql template serializes JavaScript array as scalar bound parameter in ANY()

## Problem

`getRecipesWithEmptyMealTypes` used a raw `sql` template to filter by a list of recipe ids with PostgreSQL's `ANY()`:

```typescript
.where(sql`${recipeIngredients.recipeId} = ANY(${recipeIds})`)
```

Where `recipeIds` is a JavaScript `number[]`. Drizzle's `sql` template tag serializes the entire array as a single bound scalar parameter. PostgreSQL then receives a text value like `"1"` or a comma-separated string on the right side of `ANY()`, causing a runtime type error.

## Symptoms

- PostgreSQL throws `'malformed array literal: "1"'` or `'op ANY/ALL (array) requires array on right side'`
- The error only triggers when `recipeIds` is non-empty; an explicit `if (recipes.length === 0) return` guard masks the empty case
- If the queried table is usually empty, the bug can lurk undetected because the failing code path is skipped entirely
- Type checking passes with no compile-time error

## Root Cause

Drizzle's `sql` template tag treats every `${}` interpolation as a bound parameter. When a JavaScript array is interpolated, Drizzle sends it as a scalar text value rather than as a PostgreSQL array literal or set of values for `ANY()`. PostgreSQL expects an actual array expression on the right side of `ANY()`, so it rejects the scalar string.

```typescript
// Bad — ${recipeIds} becomes a single scalar text parameter
db.select()
  .from(recipeIngredients)
  .where(sql`${recipeIngredients.recipeId} = ANY(${recipeIds})`);
// Generated: ... = ANY($1)  -- bound as scalar text, not an array
```

## Solution

Use Drizzle's first-class `inArray(column, jsArray)` helper from `drizzle-orm`. It emits a proper parameterized `IN (...)` / `= ANY()` with correct array binding, and safely handles empty arrays by emitting a false-equivalent condition.

```typescript
// Good — inArray handles proper binding and empty arrays
import { inArray } from "drizzle-orm";

db.select()
  .from(recipeIngredients)
  .where(inArray(recipeIngredients.recipeId, recipeIds));
```

## Prevention

- Never interpolate a JavaScript array into a raw `sql` template inside `ANY()`, `IN (...)`, or similar set operations.
- Always use `inArray()` from `drizzle-orm` for id-list filters.
- Keeping an explicit length guard for early returns is fine, but do not rely on it to hide parameter-binding mismatches.

## Related Files

- `server/storage/meal-plan-recipes.ts`

## See Also

- [Drizzle sql template parameterizes column references inside subqueries](./drizzle-sql-template-column-ref-as-param-2026-05-13.md)
- [Drizzle sql template documentation](https://orm.drizzle.team/docs/sql)
