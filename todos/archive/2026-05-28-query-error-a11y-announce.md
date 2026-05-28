---
title: "Query-consumer error states don't announce on iOS (announceForAccessibility)"
status: done
priority: low
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [deferred, react-native, accessibility]
github_issue:
---

# Query-consumer error states don't announce on iOS (announceForAccessibility)

## Summary

The ~18 loading→error transitions added by the `query-consumers-hide-error` fix (PR #262) do not call `AccessibilityInfo.announceForAccessibility` on iOS — they rely on the global query-error toast's own announcement and stay consistent with the pre-existing empty-state transitions on those screens (which also don't announce).

## Background

Flagged by the `query-consumers-hide-error` executor (PR #262) as a deliberate scope boundary: adding 18 announcements would have expanded the todo, and the merged global `QueryCache.onError` toast does announce the failure. This is a11y polish, not a silent failure — but for the confident-wrong-data screens (e.g. the calorie ring) a contextual announce is worth it.

## Acceptance Criteria

- [ ] Decide which of the ~18 error transitions warrant an iOS announce — prioritize the high-value / confident-wrong-data screens (calorie ring on `MealPlanHomeScreen`, `WeightTrackingScreen`, `useFastingTimer`) over low-value list-empty states.
- [ ] Those error transitions call `AccessibilityInfo.announceForAccessibility` on iOS, gated to the false→true transition (skip mount) to avoid announcing on focus.
- [ ] No double-announce: do NOT pair the announce with an `accessibilityLiveRegion` on the same element (Android live region + iOS-gated announce is the safe split — see `docs/rules/accessibility.md`).

## Implementation Notes

- Screens touched by PR #262: `WeightTrackingScreen`, `meal-plan/MealPlanHomeScreen`, `useFastingTimer`/`FastingScreen`, `meal-plan/GroceryListsScreen`, `meal-plan/PantryScreen`, `meal-plan/Cookbook{List,Detail,Create}Screen`, `GLP1CompanionScreen`, `FavouriteRecipesScreen`, `SavedItemsScreen`, `CookbookPickerModal`, `GroceryListPickerModal`, `meal-plan/QuickAddSheet`, `CoachProScreen`, `meal-plan/GroceryListScreen`, `HighProteinSuggestions`, `QuickLogScreen`.
- Use the announce-only + `didMountRef`/`isFirstRender` guard pattern already proven in `DailyNutritionDetailScreen` and `HistoryScreen` (PRs #259/#260).

## Dependencies

- None. PR #262 is merged; this layers on top of the error states it added.

## Risks

- Low. Additive a11y; main risk is a double-announce if paired with a live region (guarded by the AC).

## Updates

### 2026-05-28

- Initial creation from a deferred warning raised by the query-consumers-hide-error executor.
