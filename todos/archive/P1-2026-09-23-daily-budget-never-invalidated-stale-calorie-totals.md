---
title: "Home and Plan calorie totals go stale — /api/daily-budget is never invalidated by single-item food logs or goal saves"
status: done
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

- [x] Key restructured to `["/api/daily-budget", date ?? null, { tz }]` so one prefix invalidation covers every variant
- [x] Every food-log mutation (Scan confirm, QuickLog, NutritionDetail addToLog, batch confirm) and the goal save invalidate `["/api/daily-budget"]`
- [x] MealPlanHomeScreen pull-to-refresh uses `invalidateMealPlanItems` and also refreshes daily-budget + daily-summary
- [x] Test: after a food-log mutation succeeds, a mounted undated AND dated `useDailyBudget` query both refetch
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25 — RESOLVED

- `client/hooks/useDailyBudget.ts`: queryKey restructured to `["/api/daily-budget", date ?? null, { tz }]` — the date is now its own key element instead of being interpolated into the URL string at element 0, so TanStack's default (non-`exact`) `invalidateQueries` match (equality on `queryKey[0]`) reaches every date variant from one `["/api/daily-budget"]` call.
- Added the missing `["/api/daily-budget"]` invalidation to `client/screens/ScanScreen.tsx` (handleConfirmLog), `client/hooks/useQuickLogSession.ts` (both the onSuccess and the onError partial-success branches), `client/hooks/useNutritionLookup.ts` (addToLogMutation onSuccess), and `client/screens/GoalSetupScreen.tsx` (saveMutation onSuccess). `client/hooks/useBatchConfirm.ts` already invalidated it correctly for `daily_log` batch confirms — no change needed there.
- Went with the literal `["/api/daily-budget"]` string at each site (matching `useBatchConfirm.ts`'s existing style) rather than the optional `invalidateDailyNutrition(queryClient)` helper the Implementation Notes floated — kept the change minimal and inside the Scope Contract's file list (`client/lib/query-keys.ts` was not in scope).
- `client/screens/meal-plan/MealPlanHomeScreen.tsx`'s `handleRefresh` now calls the shared `invalidateMealPlanItems(queryClient)` instead of hand-rolling `invalidateQueries({queryKey:["/api/meal-plan"]})`, and also invalidates `["/api/daily-budget"]` and `["/api/daily-summary"]` (previously refreshed neither).
- Consumers of `useDailyBudget` outside the diff (`HomeScreen.tsx`, `DailySummaryHeader.tsx`, `DailyNutritionDetailScreen.tsx`) only call the hook and never construct the query key directly, so the key-shape change is safe for them — verified by both reviewers independently, not just by grep.
- TDD anchor: `client/hooks/__tests__/useDailyBudget.test.ts` gained a new test that mounts an undated and a dated `useDailyBudget` query plus the real `useBatchConfirm` hook on one shared `QueryClient`, drives a real `daily_log` mutation, and asserts both queries refetch. Confirmed failing (RED) against the pre-fix key shape before implementing, passing (GREEN) after.
- Reviewed by `code-reviewer` (baseline) and `mobile-reviewer` — both clean/advisory. One WARNING (missing test coverage on the `useQuickLogSession` onError partial-success branch's new invalidation) was fixed inline by extending the existing partial-failure test.
- Deferred, out of this todo's scope: `client/lib/offline-queue-drain.ts`'s offline-replay path invalidates scannedItems/dailySummary/frequentItems but not daily-budget (same bug class, surfaced as a `DEFERRED_WARNINGS` item for the user). Also deferred: the 6 call sites now spell the `["/api/daily-budget"]` literal rather than a shared `QUERY_KEYS.dailyBudget` constant — consistent with the pre-existing `useBatchConfirm.ts` convention, not a new inconsistency.
