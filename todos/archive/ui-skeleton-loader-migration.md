---
title: "Migrate ActivityIndicator to SkeletonLoader across 43 screens"
status: in-progress
priority: medium
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, polish, ux]
---

# Migrate ActivityIndicator to SkeletonLoader

## Summary

Replace bare `ActivityIndicator` usage with `SkeletonLoader` components across ~43 files. Skeleton loaders preserve layout and feel significantly faster to users than spinners.

## Background

The codebase has a well-built `SkeletonLoader` component (`client/components/SkeletonLoader.tsx`) with `SkeletonBox`, `SkeletonItem`, and `SkeletonList` variants, plus shimmer animation that respects `reducedMotion`. Some screens (HistoryScreen, SavedItemsScreen, GroceryListScreen) already use it correctly. However, ~43 files still use bare `ActivityIndicator`.

## Acceptance Criteria

- [ ] Audit all files importing `ActivityIndicator` in `client/` — categorize as "replace" or "keep" (some uses like FlatList footers are appropriate)
- [ ] Create screen-specific skeleton layouts for high-traffic screens:
  - [ ] ChatScreen / CoachChatScreen (message bubbles skeleton)
  - [ ] NutritionDetailScreen (nutrition card layout)
  - [ ] RecipeBrowserScreen (recipe card grid skeleton)
  - [ ] PhotoAnalysisScreen (analysis result skeleton)
  - [ ] MealPlanHomeScreen (meal plan calendar skeleton)
- [ ] Inline loading indicators in modals (GroceryListPickerModal, RecipeGenerationModal) can keep `ActivityIndicator`
- [ ] All skeleton layouts include `accessibilityLabel="Loading..."` and `accessibilityElementsHidden`
- [ ] All skeleton animations respect `useReducedMotion()`
- [ ] Tests pass

## Implementation Notes

- Use the existing `SkeletonBox`/`SkeletonList` from `client/components/SkeletonLoader.tsx`
- Follow the pattern in `HistoryScreen.tsx` (`DashboardSkeleton`) and `SavedItemsScreen.tsx` (`SavedItemsSkeleton`) for reference
- For FlatList `ListEmptyComponent`, use `SkeletonList` when `isLoading` is true
- Keep `ActivityIndicator` for: inline button loading, FlatList footers, small modal spinners
- Consider wrapping skeleton → content transition with the new `AnimatedQueryContent` component

## Dependencies

- None — `SkeletonLoader` component already exists

## Risks

- Some screens may have complex layouts that are hard to replicate as skeletons — use approximate shapes
- Ensure skeleton height matches real content to avoid layout jumps

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
- 43 files identified with ActivityIndicator usage
