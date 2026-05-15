---
title: "Add tests for server/storage/meal-plan-recipes.ts (554 LOC)"
status: done
priority: medium
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# Add tests for server/storage/meal-plan-recipes.ts

## Summary

Add unit tests for `server/storage/meal-plan-recipes.ts` (554 LOC source). Split out of `todos/archive/2026-05-15-storage-tests-tier2-followup.md` because the parent todo would have exceeded the reviewable-PR threshold and the parent author explicitly flagged this module as likely needing its own todo.

## Background

The audit-2026-05-11 testing finding flagged this module as having zero coverage. It's the largest untested storage module by far. The parent todo deferred it with the comment "554 LOC source — likely needs its own todo if it grows".

## Acceptance Criteria

- [ ] `server/storage/__tests__/meal-plan-recipes.test.ts` covers all exports:
  - `findMealPlanRecipeByExternalId`
  - `getMealPlanRecipe`
  - `getMealPlanRecipeWithIngredients`
  - `getUserMealPlanRecipes`
  - `createMealPlanRecipe` (with and without ingredients)
  - `createMealPlanFromSuggestions`
  - `updateMealPlanRecipe`
  - `deleteMealPlanRecipe` (incl. junction-table cleanup)
  - `getAllMealPlanRecipes`
  - `getAllRecipeIngredients`
  - `getUnifiedRecipes`
  - `getRecipesWithEmptyMealTypes`
  - `batchUpdateMealTypes`

## Implementation Notes

- Reuse `setupTestTransaction` / `rollbackTestTransaction` from `test/db-test-utils.ts`. Canonical template: `server/storage/__tests__/favourite-recipes.test.ts`.
- For functions that call `db.transaction()` internally (`createMealPlanRecipe` with ingredients, `createMealPlanFromSuggestions`, `deleteMealPlanRecipe`), follow the per-test unique-id pattern from `server/storage/__tests__/verification.test.ts` to sidestep the test-tx leak documented in `todos/2026-05-11-db-test-utils-savepoint-leak.md`.
- **Mock `../../lib/search-index`**: the storage module calls `addToIndex` / `removeFromIndex` against a process-wide singleton. Mock the module so tests don't leak state across tests or files.
- Many functions are simple wrappers — happy-path + one negative case is sufficient per export.

## Dependencies

- None (storage module already has production usage).

## Risks

- Low — module is in active production. Tests may surface latent bugs but probably not block anything user-facing.

## Updates

### 2026-05-15

- Created from the Tier 2 leftovers of `todos/archive/2026-05-15-storage-tests-tier2-followup.md`. The parent author flagged this module's size as a reason to split it out.
