---
title: "Coach Pro: Wire up navigation actions from block cards"
status: in-progress
priority: medium
created: 2026-04-10
updated: 2026-04-10
assignee:
labels: [coach-pro, client, navigation]
---

# Coach Pro: Wire up navigation actions from block cards

## Summary

RecipeCard, SuggestionList, and MealPlanCard block components emit navigation actions (`{ type: "navigate", screen: "RecipeDetail", params: { recipeId } }`) but `handleBlockAction` in CoachChat doesn't handle them. The buttons are non-functional.

## Background

CoachChat is a child component without access to the navigation prop. Navigation actions need the parent screen's navigation object to be threaded down, or the component needs to use `useNavigation()` directly.

## Acceptance Criteria

- [ ] RecipeCard "View" button navigates to RecipeDetail screen
- [ ] RecipeCard "Add to Plan" button navigates to meal plan picker
- [ ] SuggestionList items with navigate actions open the correct screen
- [ ] MealPlanCard "Add to Meal Plan" triggers the meal plan write flow

## Implementation Notes

- Option A: Pass `navigation` from CoachProScreen through CoachChat to block renderers
- Option B: Use `useNavigation()` from `@react-navigation/native` directly in CoachChat
- Option B is simpler — CoachChat is rendered within a navigator, so `useNavigation()` should work
- Need proper `CompositeNavigationProp` type (see MEMORY.md: "Never cast navigation types")

## Dependencies

- Coach Pro feature must be merged first
