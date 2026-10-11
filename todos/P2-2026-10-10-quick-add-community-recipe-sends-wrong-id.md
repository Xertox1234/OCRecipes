---
title: "Quick Add search: tapping a community recipe adds it to the plan by its community ID"
status: backlog
priority: medium
created: 2026-10-10
updated: 2026-10-10
assignee:
labels: [deferred, client, meal-plan]
github_issue:
---

# Quick Add search: tapping a community recipe adds it to the plan by its community ID

## Summary

`QuickAddSheet` mixes community recipes into its search results, but `handleAdd` sends every row's `id` to `POST /api/meal-plan/items` as a **meal-plan** recipe ID, including community rows. The result is either an error toast or, when the user happens to own a meal-plan recipe with the same number, the wrong recipe silently added to their plan.

## Background

Found 2026-10-10 while specifying "I tried it" + community stats (`docs/superpowers/specs/2026-10-10-recipe-tried-it-and-stats-design.md`, §10 Q1), when checking whether any path adds a community recipe to a meal plan.

- `client/components/meal-plan/QuickAddSheet.tsx` ~118-131 builds `source: "community"` rows with `id: r.id` (a `community_recipes.id`).
- `handleAdd` (~147) calls `addItemMutation.mutateAsync({ recipeId: recipe.id, ... })` without checking `source`.
- `meal_plan_items.recipeId` references `meal_plan_recipes.id`. The server's ownership check (`server/routes/meal-plan.ts` ~433, `getMealPlanRecipe(id, userId)`) is user-scoped, so this is **not** a cross-user leak. But a colliding ID adds the user's own unrelated recipe, and a non-colliding ID returns 404.
- By contrast, `RecipeBrowserScreen.handleRecipePress` (~581) routes community rows to `FeaturedRecipeDetail` instead of adding them.

Severity: medium. Wrong data written to the user's own plan (silent) or a broken add; no security exposure.

## Acceptance Criteria

- [ ] Tapping a community row in Quick Add never sends its community ID as a meal-plan `recipeId`.
- [ ] Chosen behaviour is one of: (a) open the recipe detail, like `RecipeBrowserScreen`; or (b) save a copy first via the existing create path, passing `sourceCommunityRecipeId`, then add that copy. Pick the smaller one that keeps "add from Quick Add" working; record the choice in the PR.
- [ ] A test covers a community row with an ID that collides with an owned meal-plan recipe ID.

## Implementation Notes

- Pure routing logic can be extracted to a `*-utils.ts` beside the sheet for Vitest.
- If (b) is chosen, this also makes `community_recipes.popularityMealPlans` increment for the first time (it currently has no working client path). Mention that in the PR.

## Scope Contract

- **Mechanisms to use:** existing hooks (`useAddMealPlanItem`, `useCreateMealPlanRecipe`) and navigation — nothing new.
- **Files in scope:** `client/components/meal-plan/QuickAddSheet.tsx`, a new `client/components/meal-plan/quick-add-utils.ts` (if extracted), and their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Option (b) creates a private copy per add; check that this matches how the recipe screen's "save" behaves today.

## Updates

### 2026-10-10

- Initial creation (found during the recipe-stats spec review).
