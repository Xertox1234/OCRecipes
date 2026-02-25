---
title: "Improve 3 under-tested server services"
status: done
priority: high
created: 2026-02-25
updated: 2025-07-17
assignee:
labels: [testing, server, services]
---

# Improve 3 Under-Tested Server Services

## Summary

Add test cases to 3 server services that have existing test files but remain below 40% statement coverage: `recipe-catalog.ts` (25%), `micronutrient-lookup.ts` (36%), and `adaptive-goals.ts` (36%). These are easy wins that leverage existing test infrastructure.

## Background

The server services layer is the best-tested category at 91% file coverage (22/22 services have tests). However, 3 services have significant coverage gaps. Since test files already exist, adding targeted test cases is straightforward compared to creating entirely new test files.

## Acceptance Criteria

- [x] `recipe-catalog.ts` coverage improved (was 25%) — added searchCatalogRecipes, getCatalogRecipeDetail, CatalogQuotaError, clearDetailCache tests
- [x] `micronutrient-lookup.ts` coverage improved (was 36%) — added lookupMicronutrientsWithCache, batchLookupMicronutrients tests
- [x] `adaptive-goals.ts` coverage improved (was 36%) — added computeAdaptiveGoals tests (null user, insufficient data, weight trends, recommendations)
- [x] All new tests pass alongside existing suite (82 files, 1,342 tests)
- [x] Branch coverage improved for each file

## Implementation Notes

### recipe-catalog.ts (25% → 80%+)

**Current coverage**: 25% stmts, 50% branch, 40% funcs, 27% lines
**Existing test file**: `server/services/__tests__/recipe-catalog.test.ts`

Uncovered areas likely include:
- Spoonacular API response parsing edge cases
- Search parameter building/validation
- Error handling for API failures
- Recipe detail fetching
- Pagination logic

Approach: Read the source file to identify all exported functions, then check the test file for missing cases. Mock the Spoonacular API responses.

### micronutrient-lookup.ts (36% → 80%+)

**Current coverage**: 36% stmts, 27% branch, 27% funcs, 39% lines
**Existing test file**: `server/services/__tests__/micronutrient-lookup.test.ts`
**Uncovered lines**: 65-116, 177-205

Approach: Read source to identify which functions corresponding to those line ranges are untested. Likely missing lookup functions for specific micronutrient types or edge cases in the lookup pipeline.

### adaptive-goals.ts (36% → 80%+)

**Current coverage**: 36% stmts, 50% branch, 71% funcs, 36% lines
**Existing test file**: `server/services/__tests__/adaptive-goals.test.ts`
**Uncovered lines**: 120-193

The `updateAdaptiveGoals` function appears untested — it's the main orchestration function that calls multiple storage methods and calculates adjusted goals. Needs mocking of storage calls and verification of goal adjustment logic.

## Dependencies

- Existing test files for all 3 services (already present)
- Understanding of Spoonacular API format (for recipe-catalog mocking)
- No new packages required

## Risks

- **recipe-catalog.ts** depends on external API shape — may need to capture real response formats for accurate mocking
- **adaptive-goals.ts** `updateAdaptiveGoals` may have complex interactions with storage that require careful mock setup
- Coverage tool line numbers may shift if source files have been modified since last coverage run

## Updates

### 2026-02-25
- Initial creation after Round 3 audit
- Identified 3 services with coverage below 40%
