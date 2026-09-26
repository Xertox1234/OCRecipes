---
title: Skeleton loader pattern with shimmer and reduced motion support
track: knowledge
category: design-patterns
module: client
tags: [react-native, loading, skeleton, reanimated, accessibility]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-25'
---

# Skeleton loader pattern with shimmer and reduced motion support

## When this applies

Create reusable skeleton components with shimmer animation and reduced motion support. Skeletons trigger on `isLoading` only (not `isFetching`) so they appear only on first load with no cached data.

## Examples

### Reusable skeleton box

```typescript
// client/components/SkeletonLoader.tsx
export function SkeletonBox({ width, height, borderRadius, style }: SkeletonBoxProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      shimmerValue.value = 0.5; // Static opacity for reduced motion
      return;
    }

    shimmerValue.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false,
    );

    return () => cancelAnimation(shimmerValue);
  }, [reducedMotion]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmerValue.value, [0, 0.5, 1], [0.3, 0.7, 0.3]),
  }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: theme.backgroundSecondary }, shimmerStyle, style]}
    />
  );
}
```

### Hide skeletons from screen readers

```typescript
<FlatList
  ListEmptyComponent={
    isLoading ? (
      <View accessibilityElementsHidden>
        <SkeletonList count={5} />
      </View>
    ) : (
      <EmptyState />
    )
  }
/>
```

Screen readers shouldn't announce loading placeholders. `accessibilityElementsHidden` hides the entire subtree from assistive technologies.

**Note:** The example above only sets `accessibilityElementsHidden` (iOS-only). On Android, that prop is ignored — TalkBack can still focus and announce each decorative box. To hide skeletons on both platforms, **pair** `accessibilityElementsHidden` with `importantForAccessibility="no-hide-descendants"`. The reusable `SkeletonLoadingRegion` component exported from `client/components/SkeletonLoader.tsx` wraps both props together and is the corrected, recommended approach. See the general pairing rule in [Visually-hidden-but-mounted surfaces must be hidden from the a11y tree](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md).

### Announce loading for VoiceOver

Since `accessibilityElementsHidden` makes skeletons invisible to screen readers, add an explicit announcement so users know content is loading:

```typescript
function MySkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <View accessibilityElementsHidden>
      <SkeletonBox width="80%" height={20} />
      {/* ... */}
    </View>
  );
}
```

**Note:** On screens presented as a modal (`presentation: "modal"` in the navigator), this announcement must be **delayed ~500ms** via `setTimeout` because the OS’s modal-present focus shift races the announcement, causing it to be swallowed on iOS. See [On-open announce must delay past modal present focus shift](../conventions/on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md). The delay is harmless on non-modal screens too, so components shared across modal/non-modal contexts can use the same delayed pattern uniformly.

### FlatList screens — prefer `ListEmptyComponent` over early return

```typescript
// Good — FlatList mounts immediately, pull-to-refresh works during load
<FlatList
  data={items}
  ListEmptyComponent={isLoading ? <MySkeleton /> : <EmptyState />}
  refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
/>

// Avoid — FlatList never mounts during load, no pull-to-refresh
if (isLoading) return <MySkeleton />;
return <FlatList data={items} ... />;
```

## Why

- **Screen-specific skeletons:** Define skeleton components inline in each screen file (not centralized), matching the screen's actual content layout. Skeletons are tightly coupled to their screen — they change when the layout changes.
- **Skeletons trigger on `isLoading` only** (not `isFetching`). TanStack Query's `isLoading` is true only on first load with no cached data. Using `isFetching` would flash the skeleton on every pull-to-refresh or refetch.
- **Root Cause of the shipped accessibility bug:** This doc’s own prior guidance (the original un-paired, un-delayed examples in items 1 and 2 above) is what shipped the real bug. The archived todo `todos/archive/ui-skeleton-loader-migration.md`'s acceptance criteria required `accessibilityLabel="Loading..."` **and** `accessibilityElementsHidden` on the same `<View>`, which hid the label along with the decorative boxes on iOS and left Android fully exposed (TalkBack could focus every box) because the Android pairing prop was never required. This was fixed in `todos/archive/P2-2026-09-23-skeleton-loaders-screen-reader-busy-state.md` via a new exported `SkeletonLoadingRegion` component in `client/components/SkeletonLoader.tsx`.
- **Do not bake announcements into shared low-level primitives:** A call site that already fires its own `announceForAccessibility` for the same loading state (e.g., `client/screens/SavedItemsScreen.tsx`’s `SavedItemsSkeleton`, which calls the announce itself) would **double-announce** in the same commit, and iOS drops the second of two same-commit announcements (see [Two announceForAccessibility calls in the same commit collide on iOS](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md)). Keep hiding props in the shared primitive; keep the announce at each call site. **When a shared a11y-bearing primitive’s hiding shape changes, audit EVERY consumer for BOTH directions** — not just for double-announce collision, but also the opposite: a consumer with no announce of its own can silently **lose** its only loading signal (an a11y regression by omission, not just duplication). This was caught only on a second reviewer’s confirmation pass after a first review already checked for collisions and cleared it.

## Related Files

- `client/screens/HistoryScreen.tsx` — `DashboardSkeleton` (canonical screen-inline pattern)
- `client/components/SkeletonLoader.tsx` — `SkeletonLoadingRegion`, the paired-hide + no-announce shared wrapper
- `client/screens/meal-plan/MealPlanHomeScreen.tsx`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx`
- `client/screens/CoachProScreen.tsx`
- `client/screens/PhotoAnalysisScreen.tsx`

## See Also

- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
- [Dynamic loading state labels](dynamic-loading-state-labels-2026-05-13.md)
- [Visually-hidden-but-mounted surfaces must be hidden from the a11y tree](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md)
- [On-open announce must delay past modal present focus shift](../conventions/on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md)
- [Two announceForAccessibility calls in the same commit collide on iOS](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md)
