---
title: "Create daily nutrition detail screen for calorie tap"
status: done
priority: medium
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, nutrition, new-screen]
---

# Daily Nutrition Detail Screen

## Summary

The home page calorie summary ("1,200 / 2,000 cal today") is tappable but currently navigates to the Profile tab as a placeholder. It should navigate to a dedicated daily nutrition breakdown screen.

## Acceptance Criteria

- [x] New screen showing today's nutrition breakdown (calories, macros, meals logged)
- [x] Screen added as a root modal (`DailyNutritionDetail` in RootStack)
- [x] `DailySummaryHeader` `onCalorieTap` updated to navigate to the new screen
- [x] Adaptive Goal Card shown contextually on this screen

## Implementation Notes

Could reuse data from `useDailyBudget` hook and the existing `CalorieRing` / `MicronutrientBar` components. The screen would show a daily view similar to what nutrition tracking apps show — meals logged, remaining budget, macro breakdown.
