---
title: "Nullable FK inner join silently drops rows (LEFT JOIN + COALESCE fix)"
track: bug
category: logic-errors
tags:
  [
    sql,
    postgres,
    inner-join,
    left-join,
    coalesce,
    nullable-foreign-key,
    aggregation,
    drizzle,
  ]
module: server
applies_to: ["server/storage/**/*.ts"]
symptoms:
  - "Aggregation query returns a plausible number but is missing rows"
  - "Daily-summary totals don't include records whose FK was made nullable"
  - "INNER JOIN on a previously-required FK drops rows after the column is relaxed to nullable"
created: 2026-05-13
severity: high
---

# Nullable FK inner join silently drops rows (LEFT JOIN + COALESCE fix)

## Problem

`getDailySummary()` used `INNER JOIN scannedItems` to aggregate daily nutrition. Phase 4 added meal-plan confirmation logs, which insert `dailyLogs` rows with `scannedItemId: null` and a `recipeId` pointing to a meal plan recipe. Because INNER JOIN drops rows with NULL keys, every confirmed meal-plan item became invisible in the daily summary.

## Symptoms

- An aggregation total looks reasonable but is too low.
- The bug is invisible — there is no error, just missing rows.
- Triggered by making a previously NOT NULL foreign key nullable.

## Root Cause

Before Phase 4, every `dailyLogs` row had a non-null `scannedItemId`, so INNER JOIN was lossless. Making `scannedItemId` nullable to support meal-confirmation logs (which reference `recipeId` instead) silently broke the aggregation: INNER JOIN drops the row whenever the join key is NULL.

```typescript
// Before (Phase 3): INNER JOIN — worked because scannedItemId was always non-null
const result = await db
  .select({ totalCalories: sql`SUM(${scannedItems.calories} * ...)` })
  .from(dailyLogs)
  .innerJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id));
// Meal plan confirmation logs with scannedItemId=null are silently dropped!
```

## Solution

Rewrite with LEFT JOINs on each candidate parent table, and `COALESCE` through the candidates to pick whichever source has the value:

```typescript
// After (Phase 4): LEFT JOINs with COALESCE fallback chain
const result = await db
  .select({
    totalCalories: sql`COALESCE(SUM(
      COALESCE(CAST(${scannedItems.calories} AS DECIMAL),
               CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
      * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
  })
  .from(dailyLogs)
  .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
  .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id));
```

### Key details

1. The inner `COALESCE` tries `scannedItems.calories` first, falls back to `mealPlanRecipes.caloriesPerServing`, then to `0`.
2. The outer `COALESCE(..., 0)` handles the case where `SUM` returns NULL (no rows for the day).
3. All string-stored numbers need `CAST(... AS DECIMAL)` for arithmetic — `numeric` columns return strings via Drizzle.

## Prevention

- When relaxing a previously NOT NULL foreign key to nullable, audit _every_ query that JOINs on that column. Run `grep` for the column name across the storage layer.
- Aggregation queries are the highest-risk surface because the result still type-checks as a number — there is no exception to notice.
- Add a regression test that inserts a row with the FK set to NULL and asserts the aggregation includes it.

## Related Files

- `server/storage.ts` — `getDailySummary()`
- `shared/schema.ts` — `dailyLogs.scannedItemId` (made nullable in Phase 4)
- `docs/PATTERNS.md` — "LEFT JOIN with COALESCE for Nullable Foreign Keys"

## See Also

- [ADD COLUMN with `.default()` leaves existing rows NULL](../runtime-errors/add-column-default-existing-rows-null-2026-05-13.md) — sibling migration gotcha; both rooted in SQL three-valued logic
