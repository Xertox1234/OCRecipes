---
title: "Improve coverage on 4 tested route files"
status: backlog
priority: medium
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [testing, server, routes, coverage]
---

# Improve Coverage on 4 Tested Route Files

## Summary

Add error path and edge case tests to 4 route files that already have test files but have statement coverage below 70%: `profile.ts` (46%), `exercises.ts` (61%), `nutrition.ts` (65%), and `auth.ts` (66%). These are quick wins since test infrastructure is already in place.

## Background

Round 3 created test files for 9 routes, but some have lower coverage due to missing error paths, edge cases, or untested branches. Adding targeted tests to these existing files is more efficient than creating new test files.

## Acceptance Criteria

- [ ] `server/routes/profile.ts` coverage ≥ 80% statements (currently 46%)
- [ ] `server/routes/exercises.ts` coverage ≥ 75% statements (currently 61%)
- [ ] `server/routes/nutrition.ts` coverage ≥ 80% statements (currently 65%)
- [ ] `server/routes/auth.ts` coverage ≥ 80% statements (currently 66%)
- [ ] All new tests pass alongside existing suite
- [ ] Improved branch coverage across all 4 files

## Implementation Notes

### profile.ts (46% → 80%+)

**Uncovered lines**: 38-92, 127-131
**Existing tests**: 6 tests in `server/routes/__tests__/profile.test.ts`

Gaps likely include:
- Error handling paths in GET/PUT dietary profile
- Cache invalidation edge cases (fire-and-forget pattern)
- Validation error responses
- Missing profile (404) scenario

### exercises.ts (61% → 75%+)

**Uncovered lines**: 140-241, 279-280
**Branch coverage**: 45% (lowest among tested routes)
**Existing tests**: 18 tests in `server/routes/__tests__/exercises.test.ts`

Gaps likely include:
- Exercise library creation validation errors
- Exercise log update/edit paths
- Date filtering edge cases
- Error paths when storage calls fail

### nutrition.ts (65% → 80%+)

**Uncovered lines**: 109-310, 338-339
**Function coverage**: 47% (many untested handler functions)
**Existing tests**: 21 tests in `server/routes/__tests__/nutrition.test.ts`

Gaps likely include:
- Scanned item update/edit endpoints
- Nutrition cache interactions
- Daily log aggregation paths
- Error handling for nutrition lookup failures

### auth.ts (66% → 80%+)

**Uncovered lines**: 100-228, 238-250
**Existing tests**: 19 tests in `server/routes/__tests__/auth.test.ts`

Gaps likely include:
- Password change endpoint
- Account deletion endpoint
- Token refresh logic
- Validation errors for profile updates
- Edge case: login with non-existent user vs wrong password

### Approach

For each file:
1. Run `npx vitest run --coverage` and check uncovered line ranges
2. Read those lines in the source file to identify untested code paths
3. Add tests to the existing test file targeting those specific paths
4. Re-run coverage to verify improvement

## Dependencies

- Existing test files for all 4 routes (already present)
- No new packages required

## Risks

- Some uncovered paths may be error-handling middleware that's hard to trigger via supertest
- Fire-and-forget async patterns (like cache invalidation) require `setTimeout` tricks to assert

## Updates

### 2026-02-25
- Initial creation after Round 3 audit
- 4 route files identified with coverage below 70%
