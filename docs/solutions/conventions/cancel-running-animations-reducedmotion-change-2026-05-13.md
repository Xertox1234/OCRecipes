---
title: "Cancel running animations on reducedMotion change"
track: knowledge
category: conventions
tags: [react-native, reanimated, reduced-motion, animation, cleanup]
module: client
applies_to: ["client/components/**/*.tsx"]
created: 2026-05-13
---

# Cancel running animations on reducedMotion change

## Rule

When `reducedMotion` toggles at runtime (user enables Reduce Motion while the app is open), actively cancel running `withRepeat` animations and reset shared values.

## Examples

```tsx
const dot1 = useSharedValue(0);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(dot1);
    dot1.value = 0; // Reset to rest position
    return;
  }
  dot1.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
}, [dot1, reducedMotion]);
```

## Why

Simply returning early from the effect doesn't stop already-running `withRepeat` animations. The shared values continue animating on the UI thread. `cancelAnimation()` explicitly stops them, and resetting to 0 (or 1, depending on the rest state) ensures a clean visual state.

## Exceptions

When to use: any `useEffect` that starts `withRepeat` or continuous animations conditionally on `reducedMotion`.

When NOT to use: one-shot entrance animations using the `entering` prop (these are handled by passing `undefined` when `reducedMotion` is true).

## Related Files

- `client/components/ChatBubble.tsx` — typing indicator dots
- `client/components/VoiceLogButton.tsx` — recording pulse

## See Also

- [Reduced motion animation pattern](../design-patterns/reduced-motion-animation-pattern-2026-05-13.md)
- [useAccessibility hook pattern](../design-patterns/use-accessibility-hook-pattern-2026-05-13.md)
