---
title: CHECK constraint for mutually-optional FK pairs
track: knowledge
category: conventions
module: shared
tags: [database, schema, drizzle, check-constraint, foreign-keys, integrity]
applies_to: [shared/schema.ts]
created: '2026-05-13'
---

# CHECK constraint for mutually-optional FK pairs

## Rule

When a table has two nullable foreign keys where at least one must be non-null (e.g., `dailyLogs` must reference either a `scannedItem` or a `recipe`), add a PostgreSQL CHECK constraint via Drizzle's `check()` to prevent ghost rows at the schema level.

## Examples

```typescript
export const dailyLogs = pgTable(
  "daily_logs",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").references(() => scannedItems.id),
    recipeId: integer("recipe_id").references(() => mealPlanRecipes.id),
    // ... other columns
  },
  (table) => ({
    hasNutritionSource: check(
      "daily_logs_has_source",
      sql`scanned_item_id IS NOT NULL OR recipe_id IS NOT NULL`,
    ),
  }),
);
```

## When to use

Any table where a row must reference one of several possible parent tables via nullable FKs (polymorphic references without a discriminator column).

## Why

Application-level validation can be bypassed by direct DB access, bulk imports, or future code paths. The CHECK constraint is an immutable database-level invariant that prevents data corruption regardless of how the row is inserted.

## Related Files

- `shared/schema.ts` — `dailyLogs` table with `daily_logs_has_source` check

## See Also

- [Non-negative CHECK constraints on all nutrition tables](non-negative-check-constraints-nutrition-tables-2026-05-13.md)
- [NOT NULL on foreign keys](not-null-on-foreign-keys-2026-05-13.md)
- [dailyLogs.recipeId references only mealPlanRecipes (intentional)](daily-logs-recipe-id-references-meal-plan-only-2026-05-13.md)
