---
title: "Home and Plan calorie totals go stale — /api/daily-budget is never invalidated by single-item food logs or goal saves"
status: backlog
priority: high
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, client-state]
github_issue:
---

# Home and Plan calorie totals go stale — /api/daily-budget is never invalidated by single-item food logs or goal saves

## Summary

After logging a food via Scan confirm, QuickLog, or NutritionDetail, Home's "X / Y cal" header keeps showing the old total, and a calorie-goal change never reaches Plan's calorie ring. The `/api/daily-budget` query is invalidated by exactly one site (`useBatchConfirm`).

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **H1, L3, L6** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- Home stays mounted as a bottom tab; global `staleTime` is 5 min with `refetchOnWindowFocus: false`, and Home's `useFocusEffect` (HomeScreen.tsx ~:320) only closes drawers — nothing refetches the budget.
- Food-log mutations invalidate only `/api/daily-summary`, `/api/scanned-items`, `frequentItems` (ScanScreen.tsx:308, useQuickLogSession.ts:259-267, useNutritionLookup addToLog). GoalSetupScreen.tsx:296-305 invalidates `/api/goals` + `/api/daily-summary`.
- `useDailyBudget.ts:21` interpolates the date into key element 0 (`[`/api/daily-budget${params}`, { tz }]`), so the dated variant used by MealPlanHomeScreen can never be prefix-invalidated (TanStack matches element-wise). The undated Home key IS reached by `useBatchConfirm`'s prefix — the misses are single-item logs, goal saves, and every dated key.
- L6: MealPlanHomeScreen `handleRefresh` (:1065-1068) hand-rolls `/api/meal-plan` invalidation instead of `invalidateMealPlanItems`, and skips `/api/daily-summary` (confirm checkmarks) and the budget.
- Research (Context7, TanStack Query 5.101: Query Invalidation, Query Keys, Important Defaults; React Navigation 7 lifecycle): verdict `better-fix`.

## Acceptance Criteria

- [ ] Key restructured to `["/api/daily-budget", date ?? null, { tz }]` so one prefix invalidation covers every variant
- [ ] Every food-log mutation (Scan confirm, QuickLog, NutritionDetail addToLog, batch confirm) and the goal save invalidate `["/api/daily-budget"]`
- [ ] MealPlanHomeScreen pull-to-refresh uses `invalidateMealPlanItems` and also refreshes daily-budget + daily-summary
- [ ] Test: after a food-log mutation succeeds, a mounted undated AND dated `useDailyBudget` query both refetch
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

- Consider a small `invalidateDailyNutrition(queryClient)` helper next to `invalidateMealPlanItems` (useMealPlan.ts:11-20) so the log sites call one function — only if it removes duplication at ≥3 call sites.
- Optional backstop (research): TanStack's React Native `useRefreshOnFocus` (`useFocusEffect` + `refetchQueries({ stale: true, type: "active" })`) on HomeScreen — decide during implementation; the invalidation fix is the primary one.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useDailyBudget.ts`
  - `client/hooks/useBatchConfirm.ts`
  - `client/screens/GoalSetupScreen.tsx`
  - `client/screens/ScanScreen.tsx`
  - `client/hooks/useQuickLogSession.ts`
  - `client/hooks/useNutritionLookup.ts`
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
  - `client/hooks/useMealPlan.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Any test/mocks asserting the old string-interpolated key must be updated.
- Changing the key invalidates any persisted query-cache entry for daily-budget (harmless — refetched).

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (H1, L3, L6).
