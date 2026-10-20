---
title: "Scan History's 'Today dashboard' mode is unreachable after QA sweep #80 — remove it"
status: in-progress
priority: low
created: 2026-10-19
updated: 2026-10-19
assignee:
labels: [deferred, ui, qa-sweep]
github_issue:
---

# Scan History's 'Today dashboard' mode is unreachable after QA sweep #80 — remove it

## Summary

PR #1520 removed the "← Today" button from the Scan History list. That button was the only thing that set `showAll: false`, so the screen's dashboard mode is now dead code.

## Background

Every way into `ScanHistory` passes `showAll: true`: the `initialParams` in `client/navigation/ProfileStackNavigator.tsx`, and `client/components/profile/library-config.ts`. `linking.ts` has no History route. With "← Today" gone (PR #1520, QA sweep #80), nothing navigates to `showAll: false`.

The code that can no longer render:

- In `client/screens/HistoryScreen.tsx`: the dashboard branch (calorie summary, `ViewAllFooter`, the `!showAll` loading state).
- In `client/hooks/useHistoryData.ts`: the dashboard data (calorie progress, the one-time VoiceOver summary announcement, `handleViewAllPress`, `isRefreshingDashboard`).

Home has its own daily summary.

## Acceptance Criteria

- [ ] Grep every `navigate("ScanHistory"` call and the linking config, and confirm nothing reaches `showAll: false`.
- [ ] Remove the dashboard mode from `HistoryScreen.tsx` and `useHistoryData.ts`, including the `showAll` param if nothing else uses it.
- [ ] Update `client/screens/__tests__/HistoryScreen.test.tsx` so the dashboard-mode cases are gone.
- [ ] The full list still loads, paginates and refreshes on pull.

## Implementation Notes

- Keep the change surgical: it is a deletion, not a restyle.
- If `showAll` is removed, update the `ScanHistory` param type in `ProfileStackNavigator.tsx` and in `client/types/navigation.ts`.

## Scope Contract

- **Mechanisms to use:** deletion only.
- **Files in scope:** `client/screens/HistoryScreen.tsx`, `client/hooks/useHistoryData.ts`, `client/navigation/ProfileStackNavigator.tsx`, `client/components/profile/library-config.ts`, `client/types/navigation.ts`, and their `__tests__`.
- No new mechanisms.

## Dependencies

- PR #1520 merged.

## Risks

- If the owner wants the in-history dashboard back, this todo should add a way to reach it instead.

## Updates

### 2026-10-19

- Filed from the PR #1520 review.
