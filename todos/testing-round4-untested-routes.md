---
title: "Test 14 untested server route files"
status: done
priority: high
created: 2026-02-25
updated: 2025-07-17
assignee:
labels: [testing, server, routes]
---

# Test 14 Untested Server Route Files

## Summary

Create integration tests for the 14 server route files that have 0% test coverage, totaling 3,694 lines of untested route logic. This is the biggest file-count gap in the test suite and will push overall route coverage from 71% toward 85-90%.

## Background

Round 3 testing added 9 route test files (auth, goals, weight, saved-items, fasting, exercises, food, nutrition, profile). However, 14 route files remain completely untested. These routes handle critical features: recipe CRUD, meal planning, grocery lists, photo analysis, chat, and subscriptions. The existing route test pattern (supertest + mocked storage/auth) is well-established and can be replicated for all remaining routes.

## Acceptance Criteria

- [x] `server/routes/__tests__/recipes.test.ts` — 558 lines (CRUD, generation, community recipes, import) ✅ 26 tests
- [x] `server/routes/__tests__/meal-plan.test.ts` — 416 lines (CRUD meal plan items, date-based queries) ✅ 23 tests
- [x] `server/routes/__tests__/grocery.test.ts` — 397 lines (grocery lists + items CRUD) ✅ 17 tests
- [x] `server/routes/__tests__/medication.test.ts` — 372 lines (GLP-1 medication logging, insights) ✅ 15 tests
- [x] `server/routes/__tests__/photos.test.ts` — 314 lines (photo upload + analysis endpoints) ✅ 6 tests
- [x] `server/routes/__tests__/suggestions.test.ts` — 302 lines (AI-powered meal/nutrition suggestions) ✅ 10 tests
- [x] `server/routes/__tests__/chat.test.ts` — 215 lines (streaming chat responses via SSE) ✅ 12 tests
- [x] `server/routes/__tests__/pantry.test.ts` — 200 lines (pantry items CRUD) ✅ 14 tests
- [x] `server/routes/__tests__/adaptive-goals.test.ts` — 197 lines (adaptive goal recalculation) ✅ 11 tests
- [x] `server/routes/__tests__/meal-suggestions.test.ts` — 191 lines (AI meal suggestions) ✅ 6 tests
- [x] `server/routes/__tests__/subscription.test.ts` — 186 lines (IAP receipt validation, status) ✅ 12 tests
- [x] `server/routes/__tests__/healthkit.test.ts` — 135 lines (HealthKit data sync) ✅ 7 tests
- [x] `server/routes/__tests__/micronutrients.test.ts` — 106 lines (micronutrient tracking) ✅ 8 tests
- [x] `server/routes/__tests__/menu.test.ts` — 105 lines (menu photo scanning) ✅ 8 tests
- [x] All new tests pass alongside existing tests (82 files, 1,342 tests total)
- [x] No test takes longer than 10 seconds

## Implementation Notes

### Established Route Test Pattern

All 9 existing route test files follow this pattern — replicate it:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// 1. Mock storage layer
vi.mock("../../storage", () => ({
  storage: { /* mock methods used by this route */ },
}));

// 2. Mock auth middleware (inject userId)
vi.mock("../../middleware/auth", () => ({
  requireAuth: (req, _res, next) => { req.userId = "1"; next(); },
}));

// 3. Mock express-rate-limit to bypass rate limiting
vi.mock("express-rate-limit", () => ({
  rateLimit: () => (_req, _res, next) => next(),
  default: () => (_req, _res, next) => next(),
}));

// 4. Import and mount route
import { registerXxxRoutes } from "../xxx";
const app = express();
app.use(express.json());
registerXxxRoutes(app);
```

### Route-Specific Considerations

- **recipes.ts** (558 lines): Largest route. Has recipe generation (mock `recipe-generation` service), community recipes, recipe import (mock `recipe-import` service). May need `checkPremiumFeature` mock from `_helpers.ts`.
- **photos.ts** (314 lines): Requires mocking `photo-analysis` service and `multer` file upload middleware. Test multipart uploads with supertest.
- **chat.ts** (215 lines): Uses Server-Sent Events (SSE) for streaming. Test the SSE response format — supertest can handle this by reading the raw response.
- **subscription.ts** (186 lines): Mock `receipt-validation` service. Test both Apple and Google receipt flows.
- **grocery.ts** (397 lines): Mock `grocery-generation` service for AI grocery list generation. Nested resource: lists have items.
- **medication.ts** (372 lines): Mock `glp1-insights` service. Test medication log CRUD + insights endpoint.

### Priority Order (by file size / complexity)

1. recipes → meal-plan → grocery → medication (largest, most complex)
2. photos → suggestions → chat (service-dependent)
3. pantry → adaptive-goals → meal-suggestions (medium)
4. subscription → healthkit → micronutrients → menu (smaller)

## Dependencies

- `supertest` and `@types/supertest` — already installed as devDeps
- Existing route test files for reference patterns
- Must read each route file before writing tests to identify storage methods, services, and validators used

## Risks

- **chat.ts SSE streaming**: Testing Server-Sent Events via supertest may require special handling (buffering the response body, parsing `data:` lines)
- **photos.ts multipart upload**: Supertest can attach files, but multer mock may need careful setup
- **Premium feature checks**: Several routes use `checkPremiumFeature` from `_helpers.ts` — may need to mock or test both free and premium paths
- **recipes.ts complexity**: At 558 lines, this is the largest route file and has many code paths — may need 30+ tests

## Updates

### 2026-02-25
- Initial creation after Round 3 audit
- 14 untested route files identified totaling 3,694 lines
