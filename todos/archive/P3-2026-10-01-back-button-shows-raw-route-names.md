---
title: "Stack back buttons show raw route names (GroceryLists, MealPlanHome, CookbookDetail)"
status: done
priority: low
created: 2026-10-01
updated: 2026-10-02
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

- [x] No back button in the Home, Plan, Coach or Profile stacks shows a raw route name (camel-cased identifiers like `GroceryLists`).
- [x] Back buttons show either a readable title or the arrow alone (decide which; `headerBackButtonDisplayMode: "minimal"` is the one-line app-wide option).
- [x] Checked on the iOS simulator for at least Plan → Grocery Lists → list and Profile → Cookbooks → cookbook.

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

### 2026-10-02

- Implemented: a shared `headerBackTitle: "Back"` in `client/hooks/useScreenOptions.ts`, pinned by one added assertion in `client/hooks/__tests__/useScreenOptions.test.ts`.
- Measured on the iOS 26.5 simulator (iPhone 17 Pro), before then after: visible back label `< MealPlanHome` / `< GroceryLists` / `< CookbookList` then `< Back`; VoiceOver label the same raw names then `Back`; long-press history menu `CookbookList`, `Profile` then `Back`, `Back`. Checked on Plan → Grocery Lists → list, Profile → Cookbooks → cookbook, RecipeCreate (a `usePreventRemove` screen) and, via `ocrecipes://chat/1`, a Chat screen pushed over the header-hidden CoachPro.
- Chose a generic "Back" over `headerBackButtonDisplayMode: "minimal"`: `minimal` hid the visible label but left the VoiceOver label as the raw route name (measured).
- Not done: readable per-screen labels ("Grocery Lists", "Plan") would need a `title:` beside each function `headerTitle`, about 40 edits across the Plan, Coach and Profile stacks. Say if wanted.
