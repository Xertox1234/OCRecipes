---
title: "P1: Remove dead code — unused hooks, routes, and speculative features"
status: backlog
priority: high
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [code-quality, p1, meal-plan, cleanup]
---

# P1: Remove dead code — unused hooks, routes, and speculative features

## Summary

Several hooks, routes, schema columns, and indexes were built speculatively and are never called or used by any screen. ~125 lines of pure dead code.

## Background

Identified by code simplicity review of `feat/meal-planning-phase-1`.

## Acceptance Criteria

- [ ] Delete `useUpdateMealPlanItem` hook (`client/hooks/useMealPlan.ts:50-79`)
- [ ] Delete `useDeleteMealPlanRecipe` hook (`client/hooks/useMealPlanRecipes.ts:94-110`)
- [ ] Delete PUT `/api/meal-plan/items/:id` route and `updateMealPlanItemSchema` (`server/routes.ts:1940-1951, 2180-2218`)
- [ ] Remove unused `source` column on `mealPlanItems` (`shared/schema.ts:494`)
- [ ] Remove unused triple-column index `mealPlanItems_user_date_meal_idx` (`shared/schema.ts:506-509`)
- [ ] Remove unused `displayOrder` columns on `mealPlanItems` and `recipeIngredients`
- [ ] Remove pointless `getApiKey()` wrapper in `recipe-catalog.ts:91-94` — use `SPOONACULAR_API_KEY` directly
- [ ] No regressions on tests

## Implementation Notes

Straightforward deletions. Run `npm run check:types` and `npm run test:run` after each removal to verify nothing breaks.

## Dependencies

- None

## Risks

- Low — these are confirmed unused by grep across the entire codebase

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
