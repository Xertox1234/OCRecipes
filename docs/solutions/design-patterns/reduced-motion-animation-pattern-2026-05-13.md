---
title: "Reduced motion animation pattern — entrance vs press vs continuous"
track: knowledge
category: design-patterns
tags: [react-native, accessibility, reduced-motion, reanimated, animation]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Reduced motion animation pattern — entrance vs press vs continuous

## When this applies

Skip or simplify animations when the user has reduced motion enabled. WCAG 2.1 requires respecting the "prefers-reduced-motion" setting to prevent motion sickness and cognitive overload.

## Examples

### Entrance animations — pass `undefined`

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";
import Animated, { FadeInDown } from "react-native-reanimated";

function ListItem({ item, index }: { item: Item; index: number }) {
  const { reducedMotion } = useAccessibility();

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      {/* content */}
    </Animated.View>
  );
}
```

### Press animations — skip `withSpring`

```typescript
const handlePressIn = () => {
  if (!reducedMotion) {
    scale.value = withSpring(0.98, pressSpringConfig);
  }
};

const handlePressOut = () => {
  if (!reducedMotion) {
    scale.value = withSpring(1, pressSpringConfig);
  }
};
```

### Continuous / looping animations — static fallback + early return

```typescript
const cornerOpacity = useSharedValue(0.6);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cornerOpacity.value = 0.8; // Static fallback value
    return; // Skip animation setup entirely
  }

  // Only start continuous animation if reduced motion is disabled
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1, // Infinite repeat
    true, // Reverse direction
  );
}, [reducedMotion]); // Re-run if preference changes
```

### Approach by animation type

| Animation Type              | Reduced Motion Approach         |
| --------------------------- | ------------------------------- |
| Entrance (`entering` prop)  | Set to `undefined`              |
| Press (scale on tap)        | Skip `withSpring` call          |
| Continuous (pulse, shimmer) | Set static value + early return |

## Why

WCAG 2.1 requires respecting the "prefers-reduced-motion" setting. This prevents motion sickness and cognitive overload for users who need it. Each animation type needs a different approach because Reanimated handles them differently.

## Exceptions

When to use the continuous variant: pulse effects, shimmer loaders, breathing animations, any `withRepeat` with `-1` (infinite).

## See Also

- [Cancel running animations on reducedMotion change](../conventions/cancel-running-animations-reducedmotion-change-2026-05-13.md)
- [useAccessibility hook pattern](use-accessibility-hook-pattern-2026-05-13.md)
- [Skeleton loader pattern](skeleton-loader-pattern-2026-05-13.md)
