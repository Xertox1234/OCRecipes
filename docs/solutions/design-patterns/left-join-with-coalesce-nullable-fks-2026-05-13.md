---
title: "LEFT JOIN with COALESCE for nullable foreign keys"
track: knowledge
category: design-patterns
tags: [database, drizzle, sql, aggregation, joins]
module: server
applies_to: ["server/storage/**/*.ts"]
created: 2026-05-13
---

# LEFT JOIN with COALESCE for nullable foreign keys

## When this applies

When a table has nullable foreign keys that can reference different source tables (e.g., `dailyLogs` can have nutrition from `scannedItems` OR `mealPlanRecipes`), use LEFT JOINs with nested COALESCE to pull values from whichever source is present.

## Examples

```typescript
const result = await db
  .select({
    totalCalories: sql<number>`COALESCE(SUM(
      COALESCE(
        CAST(${scannedItems.calories} AS DECIMAL),
        CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL),
        0
      ) * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
    // ... repeat for protein, carbs, fat
    itemCount: sql<number>`COUNT(${dailyLogs.id})`,
  })
  .from(dailyLogs)
  .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
  .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id))
  .where(
    and(
      eq(dailyLogs.userId, userId),
      gte(dailyLogs.loggedAt, startOfDay),
      lt(dailyLogs.loggedAt, endOfDay),
    ),
  );
```

## Why

1. **INNER JOIN breaks on NULL FK** — if `scannedItemId` is null, INNER JOIN drops the row entirely, making confirmed meal plan items invisible in summaries
2. **Double COALESCE** — outer COALESCE handles the SUM being null (no rows), inner COALESCE handles per-row fallback between multiple source columns
3. **CAST is required** — Drizzle's `text()` columns storing numbers need explicit CAST to DECIMAL for arithmetic

## When to use

- Aggregation queries where the main table has multiple nullable FKs pointing to different source tables
- Summary queries that must include rows regardless of which source provided the data

## Exceptions

- Simple queries where the FK is always non-null (use INNER JOIN)
- Queries that should exclude rows with no match (use INNER JOIN intentionally)

## Related Files

- `server/storage/nutrition.ts` — `getDailySummary()` method
- Related learning: "getDailySummary LEFT JOIN Rewrite" in LEARNINGS.md

## See Also

- [Soft delete with aggregation guard](soft-delete-with-aggregation-guard-2026-05-13.md)
- [dailyLogs.recipeId references only mealPlanRecipes (intentional)](../conventions/daily-logs-recipe-id-references-meal-plan-only-2026-05-13.md)
