---
title: 'A failed Plan week fetch renders as an empty week, and Recipe detail says "Recipe not found" for network errors — no inline error or retry'
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability]
github_issue:
---

# A failed Plan week fetch renders as an empty week, and Recipe detail says "Recipe not found" for network errors — no inline error or retry

## Summary

Two screens present load failures as legitimate content. MealPlanHome never reads the meal-plan query's `isError`, so a failed fetch looks like an empty week. FeaturedRecipeDetail shows "Recipe not found" with no retry for any error, including network and 5xx. The global toast is transient.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M18, M19** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- M18: `client/screens/meal-plan/MealPlanHomeScreen.tsx:620-639` (only `isLoading`/`isRefetching` destructured), :1199.
- M19: `client/screens/FeaturedRecipeDetailScreen.tsx:155-158, 208-216`.
- Reference pattern: `client/screens/HistoryScreen.tsx:758-786` (error branch with Try Again, only when there is no cached data). Rule: static error copy must not assert a false cause (`docs/solutions/logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md`).
- Research (TanStack v5 Query Basics; `isLoadingError` vs `isRefetchError`): `confirmed`.

## Acceptance Criteria

- [x] MealPlanHome shows an inline error state with retry on `isLoadingError`, and keeps stale data on `isRefetchError`
- [x] FeaturedRecipeDetail distinguishes a genuine 404 ("not found") from other errors (generic copy + retry)
- [x] Tests for each branch
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Reuse the existing EmptyState/error components used by HistoryScreen.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/screens/FeaturedRecipeDetailScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Whether a 404 is detectable depends on what the fetcher throws (`ApiError` status) — verify.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M18, M19).

### 2026-09-25

- Implemented. `MealPlanHomeScreen.tsx` now destructures `isLoadingError`/`isRefetchError`/`refetch` from `useMealPlanItems()` and shows an inline `EmptyState` + retry on `isLoadingError` only, so `isRefetchError` falls through and keeps showing the stale week. `FeaturedRecipeDetailScreen.tsx` now branches on `error instanceof ApiError && error.code === ErrorCode.NOT_FOUND` to show "Recipe not found" (no retry) for a genuine 404 and a generic "Couldn't load this recipe" + Try Again for anything else (network, 5xx), gated so a background refetch failure over already-loaded content keeps showing that content. Both screens announce the new error transitions via `AccessibilityInfo.announceForAccessibility` (mobile-reviewer WARNING, fixed inline).
- TDD verified: reverted both implementation files to `main` (`44ba63ba`), ran the new/modified test files — 5 tests failed as expected (RED). Re-applied the implementation — all 43 tests passed (GREEN). After the review-fix commit, the full suite is 46/46 passing across the two test files.
- Reviewed by `code-reviewer` + `mobile-reviewer` (no CRITICAL findings; one WARNING + one SUGGESTION, both fixed inline — see commit `2aac8416`).
- The 404-vs-other-error risk noted above was verified: both `GET /api/recipes/:id` and `GET /api/meal-plan/recipes/:id` return `sendError(res, 404, "Recipe not found", ErrorCode.NOT_FOUND)`, and the client's `throwIfResNotOk`/`getQueryFn` thread that `code` into `ApiError.code`, so branching on `.code === ErrorCode.NOT_FOUND` reliably distinguishes it from network/5xx failures.
