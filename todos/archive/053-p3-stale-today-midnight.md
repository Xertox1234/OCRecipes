---
title: "P3: Fix stale 'today' value when app stays open past midnight"
status: backlog
priority: low
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [bug, p3, meal-plan]
---

# P3: Fix stale 'today' value when app stays open past midnight

## Summary

`today` in `MealPlanHomeScreen` is captured once via `useMemo([], [])` and never updates. If the app stays open past midnight, the wrong day is highlighted and the wrong week data is fetched.

## Background

`client/screens/meal-plan/MealPlanHomeScreen.tsx:374-378` — `useMemo` with empty deps captures the date once at mount time.

## Acceptance Criteria

- [ ] Update `today` when the app returns to foreground or date changes
- [ ] "Today" dot indicator and date highlighting remain correct across midnight
- [ ] No unnecessary re-renders from the fix

## Implementation Notes

Use `AppState` change listener or a timer that checks at intervals. Or use `useFocusEffect` to recalculate on screen focus.

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
