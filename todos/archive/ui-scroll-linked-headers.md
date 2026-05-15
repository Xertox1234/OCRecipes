---
title: "Add scroll-linked collapsing headers to key screens"
status: in-progress
priority: low
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, animation, performance]
---

# Scroll-Linked Collapsing Headers

## Summary

Add collapsing/shrinking headers that respond to scroll position on screens with prominent headers, using `useAnimatedScrollHandler` and `useAnimatedStyle` from Reanimated 4.

## Background

Several screens have large fixed headers that consume valuable vertical space. Collapsing them on scroll would show more content and create a polished, modern feel. This is a high-effort improvement that requires careful performance tuning.

## Acceptance Criteria

- [ ] HomeScreen: shrink DailySummaryHeader (stats cards collapse to a single-line summary bar)
- [ ] RecipeBrowserScreen: collapse search/filter bar on scroll, expand on scroll-to-top
- [ ] ProfileScreen: collapse profile card (avatar + name shrink to compact header)
- [ ] Smooth 60fps animation driven by `useAnimatedScrollHandler`
- [ ] Headers snap to collapsed/expanded (no half-states) using scroll event thresholds
- [ ] Pull-to-refresh still works correctly with collapsed headers
- [ ] `reducedMotion`: headers remain in default (expanded) state, no scroll-linked animation
- [ ] Tests pass

## Implementation Notes

- Use `useAnimatedScrollHandler` to track `contentOffset.y`
- Interpolate header height and content transforms based on scroll offset
- Use `Animated.ScrollView` or pass `onScroll` to FlatList's `scrollEventThrottle={16}`
- Consider `Extrapolation.CLAMP` to prevent over-collapse
- For HomeScreen: the sticky collapsed bar should show calories summary at minimum
- For search bars: use `scrollToOffset` to snap header state on scroll end
- Performance: keep all calculations on the UI thread via worklets

## Dependencies

- None — Reanimated 4 is already installed

## Risks

- High effort — each screen needs custom interpolation logic
- Must test on real devices (simulator hides jank at low frame rates)
- Pull-to-refresh interaction with collapsing headers can be tricky
- Android vs iOS scroll behavior differences

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
