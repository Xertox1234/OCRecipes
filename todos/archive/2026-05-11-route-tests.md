---
title: "HTTP-level tests for recipe-catalog, recipe-import, recipe-search routes"
status: in-progress
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# HTTP-level tests for recipe-catalog, recipe-import, recipe-search routes

## Summary

Three route modules (`recipe-catalog.ts`, `recipe-import.ts`, `recipe-search.ts`) register multiple `app.get`/`app.post` HTTP handlers but have no route-level tests. The services they call are tested, but the HTTP boundary (auth, Zod validation, rate-limit middleware, `handleRouteError`) is uncovered.

## Background

Surfaced by audit 2026-05-11 (finding M4 in `docs/audits/2026-05-11-testing.md`). Audit 2026-04-18 added premium gates to `/catalog/search` and `/:id` (H7 fix). Those gates are protected at the route layer — without route tests, a future refactor could silently disable them.

## Acceptance Criteria

- [ ] `server/routes/__tests__/recipe-catalog.test.ts` exists, covering each registered handler with:
  - Auth: 401 without token
  - Validation: 400 with Zod error format on malformed query
  - Premium gate: 403 when `subscriptionTier !== "premium"` (where applicable)
  - Rate limit: 429 after limit exceeded (use a tighter test limiter or mock)
  - Happy path: 200 with expected response shape
- [ ] `server/routes/__tests__/recipe-import.ts` — same coverage profile, plus URL-import async image-generation behavior (`generateAndPatchRecipeImage` fires void after DB save — assert response returns before image generation completes)
- [ ] `server/routes/__tests__/recipe-search.ts` — same coverage profile for `/api/recipes/search` and `/api/recipes/browse`. Include the `numericPassThrough` null/empty-string filter behavior from audit 2026-04-18 H10 fix.

## Implementation Notes

- Use `supertest` against an `app` built via `createApp()` helper used by existing route tests (e.g., `recipe-generate.test.ts`)
- Mock `storage` and the service layer; do NOT hit the real DB at the route-test level (storage tests cover DB)
- For premium-gate assertions, use `createMockUser({ subscriptionTier: "premium" | "free" })` factory

## Dependencies

None — all three route files already exist and are exercised in production.

## Risks

- Mock-heavy tests can drift from real service behavior. Mitigate by keeping the service layer tests as ground truth.
