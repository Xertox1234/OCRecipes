---
title: "Drizzle sql template parameterizes column references inside subqueries"
track: bug
category: runtime-errors
tags: [drizzle, sql-template, postgresql, subquery, correlated-subquery]
module: server
applies_to: ["server/storage/**/*.ts"]
symptoms:
  - "Correlated subquery with Drizzle sql template returns 0 always"
  - "Generated SQL has $1 where a column name was expected"
  - "Same SQL run directly in psql returns the correct value"
created: 2026-03-23
severity: high
---

# Drizzle sql template parameterizes column references inside subqueries

## Problem

A correlated COUNT subquery using Drizzle's `sql` template tag always returned 0, even though the same SQL run directly against PostgreSQL returned the correct count. Drizzle treats all `${}` interpolations as bound parameters — `cookbooks.id` was serialized as `$1` instead of emitted as a column reference.

## Symptoms

- COUNT subquery returns 0 for every parent row
- Type checking passes; no compile error
- Plain SQL equivalent returns expected counts
- Only caught during device testing because zero looks plausible

## Root Cause

Drizzle's `sql` template tag treats every `${}` interpolation as a bound parameter. For user-provided values this is correct (prevents SQL injection). For a Drizzle column reference like `cookbooks.id`, the tag serializes the column object as a parameter value rather than emitting the column name in the SQL.

```typescript
// Bad — ${cookbooks.id} becomes $1, a bound parameter
const rows = await db
  .select({
    recipeCount:
      sql<number>`(SELECT COUNT(*) FROM cookbook_recipes WHERE cookbook_id = ${cookbooks.id})`.as(
        "recipe_count",
      ),
  })
  .from(cookbooks);
// Generated: ... WHERE cookbook_id = $1
```

## Solution

Use Drizzle's query builder (JOIN + `count()`) so column references are emitted correctly:

```typescript
// Good — JOIN expresses the relationship; count() aggregates safely
import { count } from "drizzle-orm";

const rows = await db
  .select({
    id: cookbooks.id,
    recipeCount: count(cookbookRecipes.id),
  })
  .from(cookbooks)
  .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
  .groupBy(cookbooks.id);
```

## Prevention

- Never use `${table.column}` inside `sql` template strings to reference columns from the outer query.
- For correlated subqueries, use the query builder's JOIN/subquery helpers, or `sql.raw()` with hardcoded column names if unavoidable.
- This bug is HIGH severity because the failure mode is a plausible-looking zero, not a crash.

## Related Files

- `server/storage/cookbooks.ts` (or equivalent storage module using cookbook counts)

## See Also

- [Drizzle sql template documentation](https://orm.drizzle.team/docs/sql)
- [Drizzle sql template bound parameters](../conventions/drizzle-sql-template-bound-parameters-2026-05-13.md)
