---
title: "ADD COLUMN with `.default()` leaves existing rows NULL"
track: bug
category: runtime-errors
tags:
  [drizzle, postgres, migration, alter-table, default, null, schema-evolution]
module: server
applies_to:
  ["shared/schema.ts", "server/storage/**/*.ts", "server/services/**/*.ts"]
symptoms:
  - "Newly added column has the expected default for new inserts but NULL for all pre-migration rows"
  - "`WHERE column = '[]'` finds zero rows even though the schema declares `.default([])`"
  - "Equality checks against the default sentinel silently skip legacy rows because `NULL = '[]'` is `NULL`, not `FALSE`"
created: 2026-05-13
severity: high
---

# ADD COLUMN with `.default()` leaves existing rows NULL

## Problem

A new JSONB column `mealTypes` was added to `mealPlanRecipes` with `.default([])` in the Drizzle schema. New inserts received `[]` as expected, but every pre-migration row received `NULL`. Backfill queries with `WHERE mealTypes::jsonb = '[]'::jsonb` found zero rows; storage queries that treated `mealTypes = '[]'` as "universal recipe (no meal-type restriction)" silently skipped every legacy recipe.

## Symptoms

- New inserts behave correctly with the column default.
- Pre-migration rows return `NULL` for the new column.
- `WHERE column = <default>` matches new rows but misses legacy rows.
- Application logic that pivots on the default value silently degrades for all data created before the migration.

## Root Cause

Drizzle's `.default([])` sets a `DEFAULT` _constraint_ on the column. The constraint only applies to future `INSERT` statements that omit the column. PostgreSQL 11+ _can_ apply the default to existing rows during `ALTER TABLE ADD COLUMN ... DEFAULT`, but only for non-volatile defaults — and Drizzle's `db push` migration strategy may not always produce that exact `ALTER TABLE` form. In practice, existing rows ended up with `NULL`.

The deeper issue is SQL three-valued logic: `NULL = '[]'` evaluates to `NULL`, not `FALSE`. A `WHERE` clause that returns `NULL` filters the row _out_, so equality checks silently skip every legacy row.

## Solution

Always pair equality checks with `IS NULL` when querying a column that may contain legacy NULL rows:

```typescript
// Bad: misses every pre-migration row
.where(sql`${table.mealTypes}::jsonb = '[]'::jsonb`)

// Good: catches empty arrays AND legacy NULLs
.where(sql`${table.mealTypes}::jsonb = '[]'::jsonb OR ${table.mealTypes} IS NULL`)
```

Alternative: backfill the legacy rows immediately after the migration:

```sql
UPDATE meal_plan_recipes SET meal_types = '[]'::jsonb WHERE meal_types IS NULL;
```

Then optionally tighten the column with `.notNull()` once the backfill is verified.

## Prevention

1. **Always write backfill queries with `OR column IS NULL`** — never assume the schema default was applied to existing rows.
2. **If the column must never be NULL**, add `.notNull()` to the schema _and_ run a backfill migration _before_ deploying queries that depend on the value.
3. **Storage queries on the new column** should treat NULL as equivalent to the default value (defensive read-side handling).
4. **Add a regression query** that asserts `COUNT(*) WHERE column IS NULL` is zero (or matches expectations) after the migration.

## Related Files

- `shared/schema.ts` — `mealTypes: jsonb("meal_types").$type<string[]>().default([])`
- `server/services/meal-type-inference.ts` — `backfillMealTypes()` query with `OR ... IS NULL`
- `server/storage/meal-plans.ts` — `getUnifiedRecipes()` filter with `OR ... IS NULL`

## See Also

- [Nullable FK inner join drops rows](../logic-errors/nullable-fk-inner-join-drops-rows-2026-05-13.md) — sibling migration gotcha; same three-valued-logic family
