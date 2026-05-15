---
title: Fix flaky DB storage integration tests
priority: medium
status: done
created: 2026-03-08
resolved: 2026-03-09
---

# Fix flaky DB storage integration tests

## Problem

The storage integration tests (`server/storage/__tests__/*.test.ts`) fail intermittently when run as part of the full test suite, but pass individually. The failures are due to DB state collisions between test files running in parallel:

- `cache.test.ts` — `invalidateSuggestionCacheForUser` / `getDailyMealSuggestionCount`
- `meal-plans.test.ts` — `deleteMealPlanRecipe` / `removeMealPlanItem` / `updateMealPlanRecipe` / `getUnifiedRecipes`

## Root Cause

`test/db-test-utils.ts` uses transaction-based isolation, but parallel workers sharing the same DB can still see username collisions (`duplicate key value violates unique constraint "users_username_unique"`). The `createTestUser` helper generates usernames that may collide across concurrent workers.

## Fix Options

1. **Use `crypto.randomUUID()` for test usernames** instead of deterministic names
2. **Add `fileParallelism: false`** for storage test files (slower but reliable)
3. **Use separate DB schemas per worker** via Vitest's `VITEST_POOL_ID` env var

## Impact

This blocks all commits via the pre-commit hook (`npm run test:run`). Currently working around by retrying commits until the flaky tests pass.
