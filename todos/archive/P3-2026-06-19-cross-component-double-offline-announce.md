---
title: "Reconcile per-screen offline announce with the always-mounted global OfflineBanner"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Reconcile per-screen offline announce with the always-mounted global OfflineBanner

## Summary

HistoryScreen, NutritionDetailScreen, and QuickLogScreen each add a
`useEffect(announceForAccessibility)` on the `isOffline` transition, but the
app-wide `OfflineBanner` already announces on the same transition. Per offline
transition a screen-reader user hears TWO announcements (with differing copy).

## Background

Finding L10 of the 2026-06-19 full audit (accessibility). The codified solution
`announceForAccessibility-isFirstRender-conditional-status-2026-06-12.md` blessed
these three per-screen announces but did not account for the always-mounted global
banner (`client/App.tsx:66`). This is cross-component double-announce (not the
same-node live-region+announce case the existing rule covers). Deferred for a
human decision on which announcement is canonical.

## Acceptance Criteria

- [ ] Decide the single canonical offline announcement (global banner vs per-screen)
      and remove the redundant one, OR gate the per-screen announce so it doesn't
      fire when the global banner already announced.
- [ ] A screen-reader user hears the offline transition announced exactly once per
      platform.
- [ ] Update the codified solution doc to record the global-banner interaction.

## Implementation Notes

- `client/components/OfflineBanner.tsx:40-68` (global, iOS announce + Android live region).
- `client/screens/HistoryScreen.tsx:678-688`, `NutritionDetailScreen.tsx:200-211`,
  `QuickLogScreen.tsx:67-78` (per-screen announces).
- Codified pattern with the blind spot:
  `docs/solutions/best-practices/announceForAccessibility-isFirstRender-conditional-status-2026-06-12.md`.
