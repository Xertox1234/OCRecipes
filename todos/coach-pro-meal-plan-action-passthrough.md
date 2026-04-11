---
title: "Coach Pro: Pass meal plan data through add_meal_plan action"
status: backlog
priority: low
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, client, enhancement]
---

# Coach Pro: Pass meal plan data through add_meal_plan action

## Summary

The `add_meal_plan` action handler in CoachChat navigates to `RecipeBrowserModal` but doesn't pass the AI-generated meal plan data through. The `action.plan` field contains a full meal plan structure (days, meals, calories, protein) but it's discarded.

## Background

Discovered during code review of the Coach Pro navigation actions implementation. The MealPlanCard component emits `{ type: "add_meal_plan", plan: { ... } }` with the full meal plan structure, but `handleBlockAction` only navigates to the modal without forwarding the data.

## Acceptance Criteria

- [ ] `add_meal_plan` action passes plan data as navigation params to `RecipeBrowserModal`
- [ ] `RecipeBrowserModal` can optionally receive and pre-populate from plan data
- [ ] User sees the AI-generated meal plan pre-filled when arriving at the screen

## Implementation Notes

- `handleBlockAction` in `client/components/coach/CoachChat.tsx` — the `add_meal_plan` branch (around line 300)
- `RecipeBrowserModal` params type in `client/navigation/RootStackNavigator.tsx` — currently `{ mealType?: string; date?: string } | undefined`
- May need to extend `RootStackParamList["RecipeBrowserModal"]` to accept optional plan data
- Consider whether the plan data shape should be a shared type in `shared/schemas/coach-blocks.ts`
