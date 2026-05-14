---
title: "Skeleton loader pattern with shimmer and reduced motion support"
track: knowledge
category: design-patterns
tags: [react-native, loading, skeleton, reanimated, accessibility]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
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

## Related Files

- `client/screens/HistoryScreen.tsx` — `DashboardSkeleton` (canonical screen-inline pattern)

## See Also

- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
- [Dynamic loading state labels](dynamic-loading-state-labels-2026-05-13.md)
