---
title: "Performance: React Native memoization gaps (2026-04-28 audit)"
status: in-progress
priority: low
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [performance, react-native]
---

# Performance: React Native Memoization Gaps

## Summary

Several components are missing `useMemo`/`useCallback` optimizations that cause unnecessary re-renders on every animation frame or theme context update.

## Background

From the 2026-04-28 audit (M7, M8, M9, M14). These are not crashes but degrade list scroll performance and cause `React.memo`-wrapped cards to re-render unnecessarily.

## Acceptance Criteria

- [ ] **M7** `MicronutrientSection` (`MicronutrientSection.tsx:157`) — wrap `classifyMicronutrients(micronutrients)` in `useMemo([micronutrients])`
- [ ] **M8** `MealSuggestionsModal` (`MealSuggestionsModal.tsx:72,170`) — move `withOpacity` calls inside `SuggestionCard` and `PopularPickCard` into `useMemo` or `StyleSheet.create`-compatible constants
- [ ] **M9** `MealSuggestionsModal` (`MealSuggestionsModal.tsx:288,292`) — destructure `{ mutate, reset }` from mutation object in `useCallback` deps instead of depending on full `mutation`
- [ ] **M14** `ReceiptReviewScreen` (`ReceiptReviewScreen.tsx:202`) — replace `theme` object dep in `renderItem` `useCallback` with specific stable theme token deps

## Implementation Notes

For M8, `withOpacity` takes stable args so `useMemo` with `[theme.text, theme.link]` deps works. For M9, `mutate` and `reset` are stable across renders in TanStack Query v5.

## Updates

### 2026-04-28

- Created from audit findings M7, M8, M9, M14
