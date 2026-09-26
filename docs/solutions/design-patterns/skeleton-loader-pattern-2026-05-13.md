---
title: Skeleton loader pattern with shimmer and reduced motion support
track: knowledge
category: design-patterns
module: client
tags: [react-native, loading, skeleton, reanimated, accessibility]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-09-26'
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
// SkeletonList wraps its items in one SkeletonLoadingRegion, which hides the
// subtree on BOTH platforms. No wrapper View needed.
<FlatList
  ListEmptyComponent={isLoading ? <SkeletonList count={5} /> : <EmptyState />}
/>

// A custom skeleton: wrap it in SkeletonLoadingRegion yourself.
<SkeletonLoadingRegion>
  <SkeletonBox width="80%" height={20} />
</SkeletonLoadingRegion>
```

Screen readers shouldn't read out loading placeholders. `SkeletonLoadingRegion`
(`client/components/SkeletonLoader.tsx`) pairs `accessibilityElementsHidden`
(iOS) with `importantForAccessibility="no-hide-descendants"` (Android). Don't
hand-roll `<View accessibilityElementsHidden>` alone: Android ignores it, so
TalkBack can focus every decorative box. The general pairing rule:
[Visually-hidden-but-mounted surfaces must be hidden from the a11y tree](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md).

### Announce loading at the call site

A hidden skeleton is silent, so the **screen** announces loading.
`SkeletonLoadingRegion` does not announce, and neither does `SkeletonList`.
Use the shared hook, which delays the announcement 500ms and cancels it if
loading ends first (or the screen unmounts), so no stale "Loading" is spoken:

```typescript
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";

useDelayedLoadingAnnouncement(isLoading);
// HistoryScreen: loading and error come from two independent queries, so it
// passes `isLoading && !isError` — an error must not be followed by "Loading".
```

The delay is required on screens presented as a modal
(`presentation: "modal"`), where the OS's modal-present focus shift swallows an
immediate announcement on iOS
([On-open announce must delay past modal present focus shift](../conventions/on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md)).
It is harmless elsewhere, so use it everywhere.

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
- **Root Cause of the shipped accessibility bug:** This doc’s own prior guidance (earlier versions of the two sections above showed an un-paired `<View accessibilityElementsHidden>` and an un-delayed announcement) is what shipped the real bug. The archived todo `todos/archive/ui-skeleton-loader-migration.md`'s acceptance criteria required `accessibilityLabel="Loading..."` **and** `accessibilityElementsHidden` on the same `<View>`, which hid the label along with the decorative boxes on iOS and left Android fully exposed (TalkBack could focus every box) because the Android pairing prop was never required. This was fixed in `todos/archive/P2-2026-09-23-skeleton-loaders-screen-reader-busy-state.md` via a new exported `SkeletonLoadingRegion` component in `client/components/SkeletonLoader.tsx`.
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
