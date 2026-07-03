---
title: 'Drizzle sql template treats ${column} as bound parameters'
track: knowledge
category: conventions
module: server
tags: [database, drizzle, sql, query-builder, gotchas]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Drizzle sql template treats ${column} as bound parameters

## Rule

Drizzle's `sql` template tag parameterizes **all** `${}` interpolations as bound values (`$1`, `$2`). This is safe for user input but **breaks column references** in correlated subqueries. Never interpolate `table.column` inside `sql` template strings — use JOINs via the query builder instead.

## Examples

```typescript
// ❌ BAD: ${cookbooks.id} becomes a bound parameter, not a column reference
sql<number>`(SELECT COUNT(*) FROM cookbook_recipes WHERE cookbook_id = ${cookbooks.id})`;
// Generates: ... WHERE cookbook_id = $1  (always returns 0)

// ✅ GOOD: Use Drizzle's query builder for column-to-column comparisons
import { count } from "drizzle-orm";
db.select({ recipeCount: count(cookbookRecipes.id) })
  .from(cookbooks)
  .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
  .groupBy(cookbooks.id);
```

## Why

Drizzle treats every `${}` substitution as a parameter binding for SQL injection safety. Column identifiers cannot be parameterized in SQL — the driver sends them as literal string values, so `WHERE cookbook_id = $1` resolves to `WHERE cookbook_id = '<some id value>'` rather than a column-to-column comparison.

## Related Files

- `server/storage/cookbooks.ts` — `getUserCookbooks()` uses LEFT JOIN + `count()` for recipe counts
- `docs/LEARNINGS.md` — Full post-mortem under "Drizzle sql Template Parameterizes Column Refs"

## See Also

- [Drizzle sql<T> is a type hint, not a runtime coercion](drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
