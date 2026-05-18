---
title: "Clean up route architecture drift"
status: done
priority: medium
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, api, architecture]
github_issue:
---

# Clean Up Route Architecture Drift

## Summary

Audit findings M7 and L5 found route architecture drift: pantry meal-plan generation performs service orchestration in the route, and several catch blocks still bypass `handleRouteError`.

## Background

The route layer should validate/authenticate, call services/storage, and return responses. The broad sweep found `POST /api/meal-plan/generate-from-pantry` fetching pantry/profile/user and computing targets directly in the route. It also found manual `logger.error` plus `sendError(500)` catch blocks in non-excluded routes.

## Acceptance Criteria

- [x] Move pantry meal-plan orchestration behind an appropriate service boundary.
- [x] Keep route behavior and response shape unchanged.
- [x] Migrate non-excluded manual catch blocks to `handleRouteError` where appropriate.
- [x] Add or update focused route/service tests for the moved pantry flow.

## Implementation Notes

Relevant files:

- `server/routes/meal-plan.ts`
- Meal-plan generation service files under `server/services/`
- Examples for catch cleanup: `server/routes/nutrition.ts`, `server/routes/admin-api-keys.ts`, `server/routes/public-api.ts`

Do not touch auth or HealthKit hard-exclusion routes as part of this cleanup.

## Dependencies

- None known.

## Risks

- Moving orchestration may accidentally change defaults for daily targets or household size.
- Broad catch-block cleanup can become noisy; keep it limited to verified examples.

## Updates

### 2026-05-16

- Created from broad-sweep audit findings M7 and L5.

### 2026-05-17

- M7 (pantry orchestration) was already resolved before this run: `buildPantryMealPlanForUser` in `server/services/pantry-meal-plan.ts` is the service boundary and `POST /api/meal-plan/generate-from-pantry` only validates input and maps errors. `server/services/__tests__/pantry-meal-plan.test.ts` already covers it (EmptyPantry, custom targets/household, default targets/household).
- L5: migrated the 5 generic catch blocks in `server/routes/meal-plan.ts` (fetch recipes, fetch recipe, delete recipe, fetch meal plan, remove item) from manual `logger.error` + `sendError(500, INTERNAL_ERROR)` to `handleRouteError`. Output is identical for non-Zod errors; ZodError handling is now correct.
- Left intentionally: the meal-confirmation catch (special 23505 unique-violation → 409 mapping) and the pantry catch (`EmptyPantryError` → 400; AI parse failures must stay 500). The `nutrition.ts` toggle-favourite catch uses a distinct `ErrorCode.TOGGLE_FAILED`; migrating it would change the response error code, so it was left to preserve response shape. `admin-api-keys.ts` and `public-api.ts` already use `handleRouteError` throughout.
