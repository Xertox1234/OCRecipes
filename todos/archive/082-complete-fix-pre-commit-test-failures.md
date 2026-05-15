---
title: "Fix pre-commit hook blocked by DB integration tests and date-sensitive test"
status: backlog
priority: high
created: 2026-03-08
updated: 2026-03-08
assignee:
labels: [testing, dx, ci]
---

# Fix pre-commit hook blocked by DB integration tests and date-sensitive test

## Summary

The pre-commit hook runs `npm run test:run` which includes storage integration tests that require a live PostgreSQL connection. When the DB isn't running (common during local development), 261 tests fail across 9 files and block every commit. There's also a date-sensitive test in `glp1-insights` that fails depending on the day of the month.

## Background

The pre-commit hook (Husky) runs the full test suite. Storage integration tests in `server/storage/__tests__/` connect to PostgreSQL via `test/db-test-utils.ts`. When the DB is unavailable, all 9 storage test files fail with `ECONNREFUSED ::1:5432`, blocking any commit regardless of what was changed.

This has been silently accumulating — any developer without a running PostgreSQL instance cannot commit.

## Failing Test Files

### DB integration tests (9 files, ~260 tests) — fail when PostgreSQL is not running:

- `server/storage/__tests__/users.test.ts`
- `server/storage/__tests__/nutrition.test.ts`
- `server/storage/__tests__/cache.test.ts`
- `server/storage/__tests__/chat.test.ts`
- `server/storage/__tests__/community.test.ts`
- `server/storage/__tests__/fasting.test.ts`
- `server/storage/__tests__/meal-plans.test.ts`
- `server/storage/__tests__/medication.test.ts`
- `server/storage/__tests__/menu.test.ts`

### Date-sensitive test (1 test):

- `server/services/__tests__/glp1-insights.test.ts` — "calculates days since start from profile" expects exactly 30 days but gets 29 on some days due to month-length differences

## Acceptance Criteria

- [ ] Storage integration tests are excluded from the pre-commit hook (run only in CI or via explicit command)
- [ ] Pre-commit hook runs only unit tests (mocked tests) that don't need external services
- [ ] Add a separate npm script for integration tests: `npm run test:integration`
- [ ] Fix the glp1-insights date test to not be brittle (use a fixed reference date or tolerate ±1 day)
- [ ] All commits can proceed without a running PostgreSQL instance
- [ ] CI pipeline still runs the full suite including integration tests

## Implementation Notes

Options for separating integration tests from unit tests:

1. **Vitest workspace or project config**: Use `vitest.workspace.ts` to define separate projects for unit vs integration tests
2. **File naming convention**: Rename storage tests to `*.integration.test.ts` and exclude via vitest config
3. **Vitest `--exclude` flag**: Update the pre-commit hook script to exclude `server/storage/__tests__/`

The simplest approach is option 3 — add an `npm run test:unit` script that excludes storage tests, and point the pre-commit hook at it.

For the glp1 test: use `vi.useFakeTimers()` or compute the expected value dynamically instead of hardcoding `30`.

## Updates

### 2026-03-08

- Identified during Activity tab removal — these failures are pre-existing on main
- 10 test files fail (9 DB + 1 date-sensitive), totaling ~261 test failures
- Root cause: `ECONNREFUSED ::1:5432` — no local PostgreSQL running
