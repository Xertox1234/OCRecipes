---
title: "Grocery/pantry/cookbook screens registered identically in three stacks"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, maintainability, client, navigation]
github_issue:
---

# Grocery/pantry/cookbook screens registered identically in three stacks

## Summary

M4: GroceryLists, GroceryList, Pantry, CookbookList, CookbookDetail, CookbookCreate are registered with identical options in `ChatStackNavigator`, `ProfileStackNavigator`, `MealPlanStackNavigator`.

## Acceptance Criteria

- [ ] ~~One shared registration function returns a `<Stack.Group>` of those screens~~ — not taken: `scripts/__tests__/navigation-route-reachability.test.ts` and `native-modal-sheet-provider.test.ts` read `<Stack.Screen name=…>` from each navigator's source, so moving the lines into a helper would blind both guards
- [x] Each stack's ParamList typing still checks (`tsc` clean); options per screen unchanged
- [x] Navigator tests pass; fallback taken: shared header options (`client/navigation/library-screen-options.tsx` — `LIBRARY_SCREEN_OPTIONS` + `cookbookCreateOptions`), `Stack.Screen` lines stay per navigator

## Scope Contract

- **Files in scope:** the three navigators, one new `client/navigation/*` shared module, their tests
