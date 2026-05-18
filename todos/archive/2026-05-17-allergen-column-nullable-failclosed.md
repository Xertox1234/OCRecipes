---
title: "Make recipe allergens column nullable so the 'Safe for me' filter is fail-closed"
status: done
priority: high
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, database, api]
github_issue:
---

# Make recipe allergens column nullable so the 'Safe for me' filter is fail-closed

## Summary

The `allergens` column added by PR #211 is `NOT NULL DEFAULT []`. An empty list cannot distinguish "this recipe was analyzed and genuinely has no allergens" from "this recipe has not been analyzed yet." Because `isRecipeSafeForAllergies` treats `[]` as safe, any not-yet-derived recipe is shown as safe to an allergic user. Make the column nullable so `null` means "not derived" and is conservatively excluded.

## Background

Surfaced during the `/todo` run that implemented the recipe-search allergen filter (PR #211). The executor stored `allergens` as `NOT NULL DEFAULT []` to keep the TS type non-nullable. The side effect: between the `0003_recipe_allergens.sql` migration and the backfill script completing, every existing recipe reads `allergens = []` and is treated as allergen-free. For a safety feature where the user explicitly chose "exclude conservatively," this fail-open window is unacceptable. The user chose to harden it rather than rely on backfill timing.

## Acceptance Criteria

- [ ] Change the `allergens` column on `communityRecipes` and `mealPlanRecipes` (`shared/schema.ts`) to nullable: `$type<{ id: AllergenId; viaDerived: boolean }[] | null>()`, drop the `.notNull()` and the `[]` default (or default `null`). Generate the migration.
- [ ] `SearchableRecipe.allergens` (`shared/types/recipe-search.ts`) and any related schema in `shared/schemas/recipe.ts` become `... | null`.
- [ ] `isRecipeSafeForAllergies` (`shared/constants/allergens.ts`) treats `null` allergens as **unsafe** — a recipe with `allergens = null` is excluded when `safeForMe` is on. `[]` continues to mean "derived, genuinely no allergens" = safe.
- [ ] The `safeForMe` predicate in `server/services/recipe-search.ts` and the search-index normalizers (`server/lib/search-index.ts`) pass `null` through correctly.
- [ ] The write-path derivation (`server/storage/community.ts`, `server/storage/meal-plan-recipes.ts`) and the backfill script (`server/scripts/backfill-recipe-allergens.ts`) always write a concrete array — `null` only ever appears for rows not yet processed.
- [ ] Tests: `isRecipeSafeForAllergies` excludes `null`-allergen recipes; the search predicate excludes them when `safeForMe` is on.

## Implementation Notes

- This builds directly on the files PR #211 introduced — see that PR's diff for the current shapes.
- The point of the change is fail-closed behavior: an un-analyzed recipe must never be presented as safe. `null` = unknown = excluded.
- After this lands, the backfill script is still wanted (so un-analyzed recipes become searchable when safe), but a missed/delayed backfill is no longer a safety hazard — it only under-includes, never falsely includes.

## Dependencies

- Builds on the code introduced by PR #211 (recipe-search allergen filter). PR #211 must be merged to `main` before this todo is started. (This references a PR, not a pending todo file — it is not an automated executor blocker, but do not start this work until #211 is on `main`.)

## Risks

- Low. Nullable-column migration on an additive column is safe; existing rows become `null` (correctly "not derived") rather than `[]`.

## Updates

### 2026-05-17

- Created during the `/todo` run for the allergen-filter todo. The user chose to harden the fail-open migration window rather than rely on operational backfill timing.
