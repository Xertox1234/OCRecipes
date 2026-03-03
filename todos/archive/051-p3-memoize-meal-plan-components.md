---
title: "P3: Memoize MealSlotSection, DailyTotals, and extract ItemSeparator"
status: backlog
priority: low
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p3, meal-plan]
---

# P3: Memoize MealSlotSection, DailyTotals, and extract ItemSeparator

## Summary

Several components in meal plan screens cause unnecessary re-renders due to missing memoization and inline component definitions.

## Background

- `MealPlanHomeScreen.tsx:190-241` — `MealSlotSection` not wrapped in `React.memo`, all 4 sections re-render when any data changes
- `MealPlanHomeScreen.tsx:245-342` — `DailyTotals` not wrapped in `React.memo`
- `RecipeBrowserScreen.tsx:581-583, 619-621` — `ItemSeparatorComponent` defined as inline arrow function, creating new component reference every render

## Acceptance Criteria

- [ ] Wrap `MealSlotSection` in `React.memo`
- [ ] Wrap `DailyTotals` in `React.memo`
- [ ] Extract `ItemSeparatorComponent` to stable module-level reference
- [ ] No regressions

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
