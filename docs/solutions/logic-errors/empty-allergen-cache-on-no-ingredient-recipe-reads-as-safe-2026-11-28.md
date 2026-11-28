---
title: "A recipe saved with no ingredients stores allergens: [] — every reader that treats [] as 'checked, none found' passes it as allergen-safe"
track: bug
category: logic-errors
tags: [database, architecture, react-native]
module: shared
applies_to: ["server/storage/meal-plan*.ts", "server/services/recipe-search.ts", "server/services/write-cards/plan.ts", "client/components/meal-plan/**/*.ts", "client/hooks/useConfirmPlanPick.ts"]
symptoms: ["The meal plan day screen shows no allergen line for a Simple Entry or imported recipe, for an eater with an allergy", "A no-ingredient recipe passes a 'safe for me' filter", "A new allergen check reads recipe.allergens and says nothing about a recipe that was never analysed"]
created: '2026-11-28'
severity: medium
---

# A no-ingredient recipe's `allergens: []` reads as "checked, none found"

## Problem

`createMealPlanRecipe` (`server/storage/meal-plan-recipes-crud.ts`) stores
`allergens: []` for a recipe saved with no ingredients, because
`deriveRecipeAllergens([])` returns `[]`. The column's own contract is
`null` = not derived, `[]` = derived and none found. So a recipe that was
never analysed (Simple Entry: a name and totals; an import with no
ingredient list) looks exactly like one that was checked and is clean.

## Symptoms

See frontmatter. Found on the day screen (#2116): `getMealClashes` returned
no clash, so `getItemFamilyInfo` showed nothing instead of "Allergens not
checked".

## Root Cause

The write path conflates "no input to analyse" with "analysed, nothing
found". Every reader must therefore re-derive "was this analysed?" from a
second signal (the ingredient count), and each one has to remember to.

## Solution

Readers gate on the ingredient count, never on the array alone:

- Recipe search "safe for me": `r.ingredients.length > 0 && isRecipeSafeForAllergies(...)` (`server/services/recipe-search.ts`).
- Coach plan write card: same guard (`server/services/write-cards/plan.ts`).
- Pick-time check: `pickedFromRecipe` returns `UNCHECKED_MEAL` when the recipe has no ingredients (`client/components/meal-plan/pick-allergen-utils.ts`, #2115).
- Day screen: `getMealPlanItems` runs one `SELECT DISTINCT recipe_id` on `recipe_ingredients` and sends `allergens: null` for a recipe with none (`server/storage/meal-plan-items.ts`, #2116). Fixing on read covered existing rows with no migration.

## Prevention

Any new code that reads `mealPlanRecipes.allergens` (or a payload built
from it) to decide safety must also know whether the recipe has
ingredients, and treat "none" as not checked. Test the no-ingredient case
next to a with-ingredients-and-`[]` control, so a check that always says
"not checked" also fails. `getMealPlanItemById` still returns the raw `[]`;
no safety path reads it today.

## Related Files

- `server/storage/meal-plan-recipes-crud.ts` — the no-ingredients insert
- `server/storage/meal-plan-items.ts` — read-side normalisation
- `client/components/meal-plan/pick-allergen-utils.ts` — `pickedFromRecipe`
- `shared/schema.ts` — the `allergens` column comment

## See Also

- [allergen check that fails returns the same empty result](../conventions/server-log-level-is-the-sentry-routing-decision-2026-10-30.md) — the same "unknown must not look like none" rule, for a failed lookup
