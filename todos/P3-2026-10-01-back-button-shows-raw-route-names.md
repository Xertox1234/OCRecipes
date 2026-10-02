---
title: "Stack back buttons show raw route names (GroceryLists, MealPlanHome, CookbookDetail)"
status: backlog
priority: low
created: 2026-10-01
updated: 2026-10-01
assignee:
labels: [deferred, react-native]
github_issue:
---

# Stack back buttons show raw route names

## Summary

On iOS the back button next to a pushed screen's title reads the previous route's internal NAME, not a human label. Examples seen on the iPhone 17 Pro simulator on 2026-10-01: "< GroceryLists", "< MealPlanHome", "< CookbookList", "< CookbookDetail". It should read "Grocery Lists", "Plan", and so on, or show just the arrow.

## Background

Noticed while verifying #1206 on the simulator; this is pre-existing and not caused by that PR. Plan → Grocery Lists already showed "< MealPlanHome" before #1206. Every stack screen sets `headerTitle` to a function (`() => <HeaderTitle … />`). A function title gives native-stack no string to use for the next screen's back label, so iOS falls back to the route name. Cosmetic only: the button works.

## Acceptance Criteria

- [ ] No back button in the Home, Plan, Coach or Profile stacks shows a raw route name (camel-cased identifiers like `GroceryLists`).
- [ ] Back buttons show either a readable title or the arrow alone (decide which; `headerBackButtonDisplayMode: "minimal"` is the one-line app-wide option).
- [ ] Checked on the iOS simulator for at least Plan → Grocery Lists → list and Profile → Cookbooks → cookbook.

## Implementation Notes

- Likely one change in `client/hooks/useScreenOptions.ts` (shared `screenOptions` for every stack): either `headerBackButtonDisplayMode: "minimal"`, or a `headerBackTitle` per screen alongside the function `headerTitle`.
- Stacks: `client/navigation/{HomeStack,MealPlanStack,ChatStack,ProfileStack}Navigator.tsx`.
- Android shows no back title, so this is iOS-only; still build both.

## Scope Contract

- **Mechanisms to use:** native-stack header options only — nothing new
- **Files in scope:** `client/hooks/useScreenOptions.ts`, `client/navigation/*StackNavigator.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Screens that override `headerLeft` (GroceryListsScreen, PantryScreen focus-trap logic) must keep their custom controls.

## Updates

### 2026-10-01

- Initial creation (found during #1206 simulator verification)
