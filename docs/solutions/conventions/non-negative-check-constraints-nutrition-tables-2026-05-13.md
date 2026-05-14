---
title: "Non-negative CHECK constraints on all nutrition tables"
track: knowledge
category: conventions
tags: [database, schema, drizzle, check-constraint, nutrition, integrity]
module: shared
applies_to: ["shared/schema.ts"]
created: 2026-05-13
---

# Non-negative CHECK constraints on all nutrition tables

## Rule

Every table that stores nutrition values (calories, protein, carbs, fat, etc.) must have `>= 0` CHECK constraints.

## Examples

```typescript
// In pgTable definition's third argument (constraints callback):
(table) => ({
  caloriesNonNeg: check("prefix_calories_gte0", sql`${table.calories} >= 0`),
  proteinNonNeg: check("prefix_protein_gte0", sql`${table.protein} >= 0`),
  carbsNonNeg: check("prefix_carbs_gte0", sql`${table.carbs} >= 0`),
  fatNonNeg: check("prefix_fat_gte0", sql`${table.fat} >= 0`),
}),
```

**Tables that have these:** `scannedItems`, `mealPlanRecipes`, `barcodeNutrition`.

**When adding a new table with nutrition columns:** Always add CHECKs. Use a short unique prefix for the constraint name (e.g., `si_`, `mpr_`, `bn_`).

**Audit origin:** 2026-04-07-full-2 finding M6 — `barcodeNutrition` was missing CHECKs that `scannedItems` and `mealPlanRecipes` already had.

## See Also

- [CHECK constraint for mutually-optional FK pairs](check-constraint-mutually-optional-fk-pairs-2026-05-13.md)
