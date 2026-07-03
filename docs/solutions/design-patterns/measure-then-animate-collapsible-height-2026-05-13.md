---
title: Measure-then-animate collapsible height with -1 sentinel for auto
track: knowledge
category: design-patterns
module: client
tags: [react-native, animation, reanimated, collapse, layout]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Measure-then-animate collapsible height with -1 sentinel for auto

## When this applies

For collapsible sections where content height is dynamic, measure via `onLayout` and animate between 0 and the measured height. Use a sentinel value (`-1`) to switch to `"auto"` after expand completes, so content reflows naturally.

## Examples

```tsx
// client/screens/meal-plan/MealPlanHomeScreen.tsx — MealSlotSection
const contentHeight = useRef(0);
const animHeight = useSharedValue(isExpanded ? -1 : 0);

// Measure content
const handleContentLayout = useCallback((e: LayoutChangeEvent) => {
  contentHeight.current = e.nativeEvent.layout.height;
}, []);

// Toggle animation
useEffect(() => {
  if (reducedMotion) {
    animHeight.value = isExpanded ? -1 : 0;
    return;
  }
  if (isExpanded) {
    animHeight.value = withTiming(
      contentHeight.current || 200,
      expandTimingConfig,
      () => {
        animHeight.value = -1;
      }, // Switch to auto after animation
    );
  } else {
    if (animHeight.value === -1) {
      animHeight.value = contentHeight.current || 200;
    }
    animHeight.value = withTiming(0, collapseTimingConfig);
  }
}, [isExpanded, reducedMotion]);

const animStyle = useAnimatedStyle(() => ({
  height: animHeight.value === -1 ? "auto" : animHeight.value,
  overflow: animHeight.value === -1 ? "visible" : "hidden",
}));
```

## Why

Fixed-height animations clip content when items are added/removed. The `-1` sentinel means "use auto height" so the container can grow naturally between user interactions.

**Key elements:**

- `onLayout` measures natural height into a `ref` (not state, to avoid re-renders)
- Animate to measured height, then switch to `auto` via `-1` sentinel in `withTiming` callback
- On collapse: snapshot current height before animating to 0
- Respect `reducedMotion` by setting final value instantly

## Exceptions

When to use: any collapsible section with dynamic-length content (lists, forms).

## Related Files

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — `MealSlotSection` collapsible

## See Also

- [Multi-section accordion with Set state](multi-section-accordion-with-set-state-2026-05-13.md)
- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
