---
title: "Split meal-plans.ts into domain-scoped storage modules"
status: done
priority: medium
created: 2026-05-09
updated: 2026-05-09
assignee:
labels: [deferred, architecture, audit-2026-05-09]
---

# Split meal-plans.ts into domain-scoped storage modules

## Summary

`server/storage/meal-plans.ts` is 990 lines / 23 exported functions — nearly 2× the ~500-line decomposition threshold. It spans 3+ coherent sub-domains that should each be their own module.

## Background

Identified in the 2026-05-09 full audit (H3) by the architecture-specialist agent. The module has grown organically as meal planning features were added, and now covers recipe CRUD, item scheduling, and aggregation/analytics — three concerns that should be separated for maintainability.

## Acceptance Criteria

- [ ] Extract `meal-plan-recipes.ts` — recipe CRUD: `getMealPlanRecipe`, `createMealPlanRecipe`, `updateMealPlanRecipe`, `deleteMealPlanRecipe`
- [ ] Extract `meal-plan-items.ts` — scheduling: `getMealPlanItems`, `addMealPlanItem`, `reorderMealPlanItems`
- [ ] Extract `meal-plan-analytics.ts` — aggregation: `getPlannedNutritionSummary`, `getMealPlanIngredientsForDateRange`, `getFrequentRecipesForMealType`, `getPopularPicksByMealType`
- [ ] Keep `meal-plans.ts` as a backward-compatible facade re-exporting everything from the sub-modules
- [ ] All existing tests pass; add any new module-level tests needed

## Implementation Notes

Follow the established pattern from other multi-file storage domains (cookbooks, nutrition). The facade re-export pattern keeps `server/storage/index.ts` and all consumers unchanged.
