---
title: 'Drizzle .default([]) does not make TypeScript type non-nullable'
track: bug
category: runtime-errors
module: shared
severity: high
tags: [drizzle, typescript, schema, nullable, array-columns]
symptoms: [Calling .filter/.map on an array column crashes at runtime with `Cannot read properties of null`, 'TypeScript inferred type is string[] | null despite `.default([])`', Legacy NULL rows trigger TypeErrors after a column was migrated to have a default]
applies_to: [shared/schema.ts]
created: '2026-05-09'
---

# Drizzle .default([]) does not make TypeScript type non-nullable

## Problem

Drizzle's `.default([])` on an array column only sets the PostgreSQL-level DEFAULT value for INSERT statements. It has **no effect on the TypeScript type**: the inferred type remains `string[] | null`, and accessing array methods on it without a null check will crash at runtime if the column is NULL in the database (e.g., rows inserted before the default was added).

## Symptoms

- `Cannot read properties of null (reading 'filter')` on production records
- Defensive `.filter()` / `.map()` on what looks like a non-null array crashes
- New code reads the column and assumes the default applies retroactively

## Root Cause

`.default([])` only affects `INSERT` statements that omit the column. Existing rows keep whatever value they had at the time (`NULL` for columns added without a backfill). Drizzle's type inference reflects the column's nullability constraint, not its default.

## Solution

Add `.notNull()` alongside `.default([])` in the schema:

```typescript
// Bad — TypeScript type is string[] | null; .filter/.map crash on legacy NULLs
allergens: text("allergens").array().default([]);

// Good — TypeScript type is string[]; DB prevents new NULLs
allergens: text("allergens").array().default([]).notNull();
```

For tables that already have NULL rows in production, either backfill (`UPDATE ... SET allergens = '{}' WHERE allergens IS NULL`) before adding `.notNull()`, or guard all read paths with `?? []` until backfill is complete.

## Prevention

When adding a new array column or migrating an existing one, always pair `.default([])` with `.notNull()`. Add a backfill step to any migration that introduces `.notNull()` on a column with existing NULL rows.

## Related Files

- `shared/schema.ts` — allergens column
- Audit 2026-05-09 M9

## See Also

- [Add column with default leaves existing rows null](add-column-default-existing-rows-null-2026-05-13.md) (deferred — see `_manifests/2026-05-13-learnings.md`)
- [Drizzle sql type hint not runtime coercion](../conventions/drizzle-sql-type-hint-not-runtime-coercion-2026-05-13.md)
