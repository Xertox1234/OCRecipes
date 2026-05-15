---
title: "Recipe routes consistency cleanup (post-split)"
status: done
priority: medium
created: 2026-04-18
updated: 2026-04-18
labels: [architecture, api, audit-2026-04-18]
---

# Recipe routes consistency cleanup

## Summary

Drift from established route/API patterns introduced during the `recipes.ts` 4-way split (commits `bed927e` + `16cf69e`). The new route files (`recipe-import.ts`, `recipe-generate.ts`) follow modern patterns, but the residual `recipes.ts`, `recipe-catalog.ts`, and `recipe-search.ts` retained some legacy error handling and inline schemas.

## Findings (cross-ref `docs/audits/2026-04-18-full.md`)

- **M26** — Nine catch blocks in `recipes.ts`, `recipe-catalog.ts`, `recipe-search.ts` use legacy `logger.error + sendError` instead of `handleRouteError(res, err, 'context')`. Migrate all nine (see `docs/patterns/api.md`).
- **M27** — `recipe-import.ts:71,146` passes `result.error` (a free-text string like `"FETCH_FAILED"`) as the `ErrorCode` arg to `sendError`. Not in the `ErrorCode` enum; clients can't switch on codes. Either add to enum (preferred) or map to `ErrorCode.VALIDATION_ERROR`.
- **M28** — Six new/split route files declare Zod schemas inline (`catalogSearchSchema`, `importUrlSchema`, `recipeGenerationSchema`, `searchQuerySchema`, `browseQuerySchema`, `generatePromptSchema`). None in `shared/schemas/recipe.ts` for client reuse. Move.
- **M29** — `POST /api/meal-plan/recipes/parse-url` (preview endpoint, 63 LOC in `recipe-import.ts:40-103`) has zero route tests. New endpoint, complex URL/SSRF/error-mapping logic.
- **L29** — `getPremiumFeatures` called on every `/generation-status` poll → `storage.getSubscriptionStatus` per request. Short in-memory cache on subscription tier (~1 min TTL) would cut DB load for clients polling for banners.
- **L30** — `recipe-generate.ts:27` comment "same contract as POST /api/recipes/generate" was accurate before H1 fix; now updated implicitly but worth a prose polish.

## Acceptance Criteria

- [x] 9 catch blocks migrated to `handleRouteError`
- [x] Recipe-import error codes added to `ErrorCode` enum OR mapped to validation
- [x] 6 Zod schemas moved to `shared/schemas/recipe.ts`
- [x] Tests added for `POST /api/meal-plan/recipes/parse-url`
- [x] Subscription tier cached ~1min
- [x] Comment accuracy polish

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferrals.

### 2026-04-18 (completed)

- Added `FETCH_FAILED`, `NO_RECIPE_DATA`, `PARSE_ERROR`, `RESPONSE_TOO_LARGE` to `shared/constants/error-codes.ts`
- Created `shared/schemas/recipe.ts` with 6 canonical Zod schemas; removed inline duplicates from all 5 route files
- Migrated all 9 manual `logger.error + sendError` catch blocks to `handleRouteError` in `recipes.ts`, `recipe-catalog.ts`, `recipe-search.ts`
- Fixed `recipe-import.ts` to map `result.error` through `ErrorCode` rather than passing raw strings to `sendError`
- Added 10 tests for `POST /api/meal-plan/recipes/parse-url` (happy path, URL validation, 5 error codes, no-content 422, service exception, free-tier access)
- Added 60-second subscription-tier cache (`generationStatusTierCache`) in `recipes.ts` for the `/generation-status` polling endpoint
- Polished `recipe-generate.ts:23` comment to explain the premium gate context
- All 3,879 tests pass; 0 lint errors
