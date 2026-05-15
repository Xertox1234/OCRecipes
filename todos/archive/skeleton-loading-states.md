---
title: "Standardize loading states with SkeletonLoader"
status: done
priority: medium
created: 2026-03-24
updated: 2026-03-24
assignee:
labels: [usability, ux, loading]
---

# Standardize Loading States with SkeletonLoader

## Summary

Replace full-screen ActivityIndicator spinners with SkeletonLoader on data screens. Each screen needs a custom skeleton layout matching its content structure.

## Background

Usability review (2026-03-24) found 3 different loading patterns used inconsistently: SkeletonLoader (best), full-screen ActivityIndicator (adequate), and no indicator (worst). Screens that load data into a content layout should use skeleton UI for perceived performance. Async operations (photo analysis, receipt processing) are fine with ActivityIndicator + progress text.

## Acceptance Criteria

- [x] SavedItemsScreen: Replace ActivityIndicator with SkeletonList (list of saved item cards)
- [x] NutritionDetailScreen: Custom skeleton matching nutrition info layout
- [x] ChatScreen: Skeleton for message bubbles
- [x] ItemDetailScreen: Custom skeleton matching item detail layout
- [x] EditDietaryProfileScreen: Skeleton for profile form fields
- [x] FeaturedRecipeDetailScreen: Skeleton matching recipe modal layout
- [x] All skeletons respect `reducedMotion` preference (existing SkeletonLoader already does)

## Implementation Notes

- Existing `SkeletonLoader.tsx` provides `SkeletonBox`, `SkeletonItem`, `SkeletonList` components
- `SkeletonList` works for list screens (SavedItemsScreen)
- Detail screens need custom compositions of `SkeletonBox` elements matching their actual layout
- Reference: `HistoryScreen` DashboardSkeleton (lines 374-410) is a good example of a custom skeleton
- Async operation screens are intentionally excluded — ActivityIndicator with progress text is correct there

## Dependencies

- None — SkeletonLoader component already exists

## Updates

### 2026-03-24

- Created from full frontend usability review
