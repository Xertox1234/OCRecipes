---
title: "MealPlanHomeScreen handleSelectSuggestion swallows mutation errors (same class as M20)"
status: backlog
priority: low
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [deferred, react-native, client-state, error-handling]
github_issue:
---

# MealPlanHomeScreen handleSelectSuggestion swallows mutation errors (same class as M20)

## Summary

`handleSelectSuggestion` in `client/screens/meal-plan/MealPlanHomeScreen.tsx` (~line 820) has the same misleading "Mutation errors handled by React Query" empty-catch pattern that finding **M20** had — a failed mutation is swallowed with no user-visible feedback.

## Background

Surfaced by the `mutations-no-visible-error` executor (PR #263) while fixing M20 (`RecipeBrowserScreen`). It was deliberately left out of scope because it is not in that todo's acceptance criteria, but it is the identical anti-pattern: the global `QueryCache.onError` net is **query-only**, so a mutation failure here produces a silent no-op.

## Acceptance Criteria

- [ ] `handleSelectSuggestion`'s mutation failure surfaces a visible error (toast / Alert / InlineError, matching the screen's existing convention) instead of being swallowed.
- [ ] The misleading "handled by React Query" comment is removed or corrected.

## Implementation Notes

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` ~line 820.
- Mirror the local `onError` → `toast.error()` pattern PR #263 applied to the other MealPlanHome mutations (M-cluster). Do NOT add a global `MutationCache.onError` (queries-only net) and do NOT add `meta:{silentError}` (query-only mechanism) — see `docs/rules/client-state.md`.

## Dependencies

- None. PR #263 (mutations-no-visible-error) is merged; this is the one site it left out of scope.

## Risks

- Low. Additive error feedback on a user-initiated action.

## Updates

### 2026-05-28

- Initial creation from a deferred warning raised by the mutations-no-visible-error executor.
