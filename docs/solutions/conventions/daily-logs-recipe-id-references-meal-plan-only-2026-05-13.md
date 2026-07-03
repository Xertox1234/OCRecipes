---
title: dailyLogs.recipeId references only mealPlanRecipes (intentional)
track: knowledge
category: conventions
module: shared
tags: [database, schema, drizzle, foreign-keys, polymorphic-fk, design-decision]
applies_to: [shared/schema.ts]
created: '2026-05-13'
---

# dailyLogs.recipeId references only mealPlanRecipes (intentional)

## Rule

`dailyLogs.recipeId` is a FK to `mealPlanRecipes.id` only. It does **not** reference `communityRecipes`. This is intentional: community recipes are not logged directly as `dailyLogs` entries. The logging flow is:

1. User adds a community recipe to their meal plan → creates a `mealPlanRecipes` row owned by the user (a personal copy).
2. Confirming or logging that meal plan item links `dailyLogs.recipeId` → the user-owned `mealPlanRecipes` row.

A `recipeType` discriminator on `dailyLogs` is therefore **not needed** — every logged recipe is already a `mealPlanRecipes` row. Adding `recipeType` would only make sense if community recipes could be logged without first being imported into a meal plan, which is not the current product behaviour.

If that flow changes (e.g., "log a community recipe directly"), add `recipeType text` to `dailyLogs` alongside a nullable `communityRecipeId` FK, following the polymorphic FK pattern used in `cookbookRecipes`. Until then, `dailyLogs.recipeId` pointing exclusively to `mealPlanRecipes` is correct.

**Origin:** 2026-04-28 audit M3 — evaluated and documented as intentional design.

## See Also

- [CHECK constraint for mutually-optional FK pairs](check-constraint-mutually-optional-fk-pairs-2026-05-13.md)
- [LEFT JOIN with COALESCE for nullable foreign keys](../design-patterns/left-join-with-coalesce-nullable-fks-2026-05-13.md)
