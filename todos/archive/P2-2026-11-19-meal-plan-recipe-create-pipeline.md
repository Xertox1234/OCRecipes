---
title: "One prepareMealPlanRecipe pipeline for the two meal-plan recipe-create routes"
status: done
priority: medium
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, meal-plan]
github_issue:
---

# One prepareMealPlanRecipe pipeline for the two meal-plan recipe-create routes

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`server/routes/meal-plan.ts` runs two parallel create pipelines: `POST /recipes` (`:159-245`) and the inline-recipe branch of `POST /items` (`:351-519`) — quality check → `sharedDishImage` (only callers `:196`, `:415`) → meal-type inference → create → fire-and-forget auto image. The audit agent's "they diverged: /recipes skips normalization" claim is FALSE: `/recipes` reaches `storage.createMealPlanRecipe`, which normalizes in storage (`server/storage/meal-plan-recipes-crud.ts:136`); `/items` normalizes in the route (`:407`).

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [x] `prepareMealPlanRecipe(input, userId)` service returns `{ ok:false, reason } | { ok:true, recipeData, mealTypes, imageKey }`
- [x] `afterRecipeCreated(...)` owns the image fire-and-forget
- [x] Both routes become validate → prepare → store → respond; response shapes and status codes unchanged
- [x] Route tests mock every `fireAndForget` service (docs/rules/testing.md)

## Implementation Notes

- Do not move normalization: storage-side normalization is deliberate ("guaranteed to be normalized, structurally").
- Review: server-reviewer.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** server/routes/meal-plan.ts, server/services/meal-plan-recipe-prepare.ts, related tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).

- Criterion 1 evidence: server/services/meal-plan-recipe-prepare.ts returns `{ok:false,reason}|{ok:true,recipeData,ingredients,sourceType,mealTypes,imageKey,sharedImageUrl}`; tests in server/services/**tests**/meal-plan-recipe-prepare.test.ts
- Criterion 4 evidence: server/routes/**tests**/meal-plan.test.ts already mocks recipe-auto-image and fire-and-forget; unchanged and green (110 tests)
