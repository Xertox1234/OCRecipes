---
title: "Deduping ids with a Set before an aggregate drops how many times each one counts — the grocery list bought one batch of a recipe planned twice"
track: bug
category: logic-errors
tags: [database, meal-plan, grocery, aggregation]
module: server
applies_to: ["server/storage/**/*.ts", "server/services/**/*.ts"]
symptoms: ["A grocery list generated for a week shows the same quantities whether a recipe is planned once or three times", "Planning a recipe at 2 servings instead of 1 does not change the grocery list", "An aggregate over rows looked up by id comes out lower than the count of source rows"]
created: 2026-11-08
severity: medium
---

# Deduping ids before an aggregate drops multiplicity

## Problem

`getMealPlanIngredientsForDateRange` (`server/storage/meal-plan-analytics.ts`) collected the
recipe ids of the planned items in a date range, deduped them with
`[...new Set(ids)]`, and fetched those recipes' ingredient rows for the grocery list.

## Symptoms

A recipe planned on Monday and again on Wednesday, or planned at 2 servings, put one batch
of ingredients on the list. `mealPlanItems.servings` was never read on this path, even
though the nutrition summary in the same file multiplies by it.

## Root Cause

The `Set` was there to stop the `inArray` lookup from asking for the same recipe twice — a
reasonable query-shaping step. But the function's result was the aggregate input, so the
dedup also erased how many times (and at what servings) each recipe was planned. The
lookup key and the multiplicity were carried in the same array.

## Solution

Keep the two apart: build a `Map<recipeId, { totalServings, yield }>` from the planned
rows (joined to `meal_plan_recipes` for the yield), fetch each recipe's ingredients once
with `inArray([...map.keys()])`, then expand the rows by the multiplicity. Owner rule
(2026-11-08): whole batches = `max(1, ceil(totalServings / yield))`, so leftovers
(Mon 1 + Tue 1 of a 2-serving recipe) still count once. Repeating the rows per batch lets
`generateGroceryItems` sum them with the same quantity parser it uses across recipes.

## Prevention

Before deduping ids, ask whether the caller aggregates the result. If it does, the dedup
belongs on the lookup only; carry the count (or the per-row multiplier, such as servings)
separately and apply it after the lookup. A test that plans the same recipe twice catches
it — the original suite only ever planned a recipe once.

## Related Files

- `server/storage/meal-plan-analytics.ts` — `getMealPlanIngredientsForDateRange`
- `server/services/grocery-generation.ts` — `generateGroceryItems`
- `server/routes/grocery.ts` — the only caller

## See Also

- `docs/solutions/logic-errors/parsefloat-truncates-fraction-and-range-quantities-2026-10-30.md` — the other grocery quantity bug on the same aggregation path
