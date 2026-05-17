---
title: "Clean up route architecture drift"
status: backlog
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

- [ ] Move pantry meal-plan orchestration behind an appropriate service boundary.
- [ ] Keep route behavior and response shape unchanged.
- [ ] Migrate non-excluded manual catch blocks to `handleRouteError` where appropriate.
- [ ] Add or update focused route/service tests for the moved pantry flow.

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
