---
title: "Improve coverage on 3 tested route files"
status: backlog
priority: medium
created: 2026-02-25
updated: 2026-02-27
assignee:
labels: [testing, server, routes, coverage]
---

# Improve Coverage on 3 Tested Route Files

## Summary

Add error path and edge case tests to 3 route files that already have test files but have statement coverage below 75%: `exercises.ts` (60%), `auth.ts` (64%), and `nutrition.ts` (66%). These are quick wins since test infrastructure is already in place.

## Background

The test suite is at 83.34% overall line coverage with 2,185 passing tests. Profile routes were improved to 97.43% and photos to 75.55%. Three route files remain below the 75% target.

## Current Coverage (as of 2026-02-27)

| Route File | Stmts | Branch | Funcs | Lines | Target |
|---|---|---|---|---|---|
| `exercises.ts` | 59.8% | 47.4% | 80% | 60.4% | ≥ 80% |
| `auth.ts` | 64.0% | 59.1% | 75% | 64.0% | ≥ 80% |
| `nutrition.ts` | 66.4% | 77.5% | 47.4% | 66.4% | ≥ 80% |

## Completed (removed from scope)

- ~~`profile.ts`~~ — now at 97.43% (was 46%)
- ~~`photos.ts`~~ — now at 75.55% (was 58.9%)

## Acceptance Criteria

- [ ] `server/routes/exercises.ts` coverage ≥ 80% statements
- [ ] `server/routes/auth.ts` coverage ≥ 80% statements
- [ ] `server/routes/nutrition.ts` coverage ≥ 80% statements
- [ ] All new tests pass alongside existing 2,185 tests

## Implementation Notes

### exercises.ts (60% → 80%+)

**Uncovered lines**: 140-247, 285-286
**Branch coverage**: 47% (lowest among tested routes)
**Existing tests**: 15 tests in `server/routes/__tests__/exercises.test.ts`

Gaps likely include:
- Exercise library creation validation errors
- Exercise log update/edit paths
- Date filtering edge cases
- Error paths when storage calls fail

### auth.ts (64% → 80%+)

**Uncovered lines**: 105-242, 252-264
**Existing tests**: 19 tests in `server/routes/__tests__/auth.test.ts`

Gaps likely include:
- Password change endpoint
- Account deletion endpoint
- Token refresh logic
- Validation errors for profile updates

### nutrition.ts (66% → 80%+)

**Uncovered lines**: 109-316, 344-345
**Function coverage**: 47% (many untested handler functions)
**Existing tests**: 21 tests in `server/routes/__tests__/nutrition.test.ts`

Gaps likely include:
- Scanned item update/edit endpoints
- Nutrition cache interactions
- Daily log aggregation paths
- Error handling for nutrition lookup failures

### Approach

For each file:
1. Run `npx vitest run --coverage` and check uncovered line ranges
2. Read those lines in the source file to identify untested code paths
3. Add tests to the existing test file targeting those specific paths
4. Re-run coverage to verify improvement

## Dependencies

- Existing test files for all 3 routes (already present)
- No new packages required

## Updates

### 2026-02-27
- Archived `testing-audit-report.md` and `testing-round4-storage-layer.md` (both completed)
- Removed `profile.ts` from scope (now 97.43%)
- Removed `photos.ts` from scope (now 75.55%)
- Updated all coverage numbers to current values
- Overall coverage now 83.34% with 2,185 tests

### 2026-02-25
- Initial creation after Round 3 audit
- 4 route files identified with coverage below 70%
