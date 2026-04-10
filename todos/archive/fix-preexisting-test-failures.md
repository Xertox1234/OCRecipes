---
title: "Fix pre-existing test failures blocking commits (16 files, 315 tests)"
status: backlog
priority: high
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [testing, coach-pro, blocker]
---

# Fix pre-existing test failures blocking commits

## Summary

Pre-commit hooks block all commits on the `worktree-coach-pro` branch because 315 tests fail across 16 files. These failures are pre-existing (not caused by any pending changes) and appear to stem from the Coach Pro feature work altering route/service signatures without updating corresponding test mocks.

## Background

The Coach Pro feature branch added premium tier checks, streaming coach responses, and new storage methods. Existing test mocks for routes like `chat` and `photos` don't account for these new dependencies, causing unhandled errors that return `503` instead of the expected status codes. Storage integration tests also fail due to missing `DATABASE_URL` in the test environment.

## Failing Test Files

### Category 1: Route tests returning 503 (mock gaps from Coach Pro changes)
- `server/routes/__tests__/chat.test.ts` — 7 failures (503 instead of 429/200; likely missing mock for `getUserById`, premium tier, or streaming coach)
- `server/routes/__tests__/photos.test.ts` — 9 failures (503 instead of expected codes; similar mock gaps)

### Category 2: Storage integration tests (no DATABASE_URL)
- `server/__tests__/storage.test.ts`
- `server/storage/__tests__/cache.test.ts`
- `server/storage/__tests__/chat.test.ts`
- `server/storage/__tests__/community.test.ts`
- `server/storage/__tests__/fasting.test.ts`
- `server/storage/__tests__/favourite-recipes.test.ts`
- `server/storage/__tests__/meal-plans.test.ts`
- `server/storage/__tests__/medication.test.ts`
- `server/storage/__tests__/menu.test.ts`
- `server/storage/__tests__/nutrition.test.ts`
- `server/storage/__tests__/users.test.ts`

### Category 3: Utility/helper tests (need investigation)
- `server/routes/__tests__/_helpers.test.ts`
- `server/routes/__tests__/batch-scan.test.ts`
- `server/services/__tests__/meal-type-inference.test.ts`

## Acceptance Criteria

- [ ] All 16 failing test files pass (or storage tests are properly excluded from pre-commit)
- [ ] Pre-commit hook succeeds, unblocking commits on the branch
- [ ] No tests are deleted — only mocks updated or test environment configured
- [ ] `npm run test:run` exits 0

## Implementation Notes

- Route test failures are most likely caused by missing `vi.mocked()` entries for new storage/service functions added during Coach Pro (e.g., `getUserById`, `getCoachUsage`, premium tier checks).
- Storage integration tests (`server/storage/__tests__/`) may already be excluded from unit test runs via `--exclude` — verify the pre-commit hook command matches `npm run test:unit` (which excludes them) vs `npm run test:run` (which does not).
- Check whether `npm run test:run` in the pre-commit hook should be `npm run test:unit` instead, since storage tests require a live database.

## Updates

### 2026-04-10
- Identified during worktree resolution — 315 tests fail across 16 files, all pre-existing on the branch before any pending changes
- Root causes: (1) Coach Pro route changes broke existing mocks, (2) storage tests need DATABASE_URL, (3) helper tests need investigation
