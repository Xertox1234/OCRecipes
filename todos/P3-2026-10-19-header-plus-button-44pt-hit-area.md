---
title: "Header '+' buttons on Grocery Lists and Cookbooks have a 40pt tap target — raise to 44pt"
status: in-progress
priority: low
created: 2026-10-19
updated: 2026-10-19
assignee:
labels: [deferred, accessibility, ui]
github_issue:
---

# Header '+' buttons on Grocery Lists and Cookbooks have a 40pt tap target — raise to 44pt

## Summary

The header "+" (`headerRight`) on Grocery Lists and on Cookbooks is a 24pt icon with `hitSlop={8}`, which makes a 40×40 tap target, under the 44pt minimum in `docs/rules/react-native.md`. Grocery Lists got this button in PR #1520 (QA sweep #29), replacing a 56pt floating button.

## Background

The mobile-reviewer raised it as a warning on PR #1520. The one-review-pass rule says to file it rather than fix it on the reviewed branch. Cookbooks' button, which #1520 copied, has the same size.

## Acceptance Criteria

- [ ] Both header "+" Pressables have a tap target of at least 44×44pt (`hitSlop` of 10 or more, or `minWidth`/`minHeight: 44` with centered content), keeping the current `marginRight`.
- [ ] A test pins the hit area (the `hitSlop` value, or the min size style) for both screens.

## Implementation Notes

- `client/screens/meal-plan/GroceryListsScreen.tsx` (header "+" near line 142)
- `client/screens/meal-plan/CookbookListScreen.tsx` (`headerRight` near line 55)
- Tests: `client/screens/meal-plan/__tests__/GroceryListsScreen.header.test.tsx`, and CookbookListScreen's tests.

## Scope Contract

- **Mechanisms to use:** `hitSlop` or a min-size style on the existing Pressable.
- **Files in scope:** the two screens above and their `__tests__`.
- No new components.

## Dependencies

- PR #1520 merged.

## Risks

- None known.

## Updates

### 2026-10-19

- Filed from the PR #1520 mobile review.
