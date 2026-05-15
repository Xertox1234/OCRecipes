---
title: "Add Create Cookbook action to home page"
status: done
priority: low
created: 2026-03-19
updated: 2026-03-19
assignee:
labels: [home, recipes, cookbook]
---

# Add Create Cookbook Action to Home Page

## Summary

Add a "Create Cookbook" action to the Recipes group on the home page. Currently omitted because no cookbook creation screen exists.

## Acceptance Criteria

- [x] Cookbook creation screen exists in MealPlanStack
- [x] Action added to `client/components/home/action-config.ts` in the "recipes" group
- [x] Navigation target wired in `navigateAction()`

## Implementation Notes

Add a single entry to `HOME_ACTIONS` in `action-config.ts` and a case to `navigateAction()`. The config-driven architecture means no component changes are needed.

## Dependencies

- Cookbook creation screen must be built first
