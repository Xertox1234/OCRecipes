---
title: useAccessibility hook — central source for reduced motion + screen reader status
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, reduced-motion, hook, reanimated]
applies_to: [client/hooks/useAccessibility.ts, client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# useAccessibility hook — central source for reduced motion + screen reader status

## When this applies

Centralize accessibility detection with a custom hook that provides reduced motion and screen reader status so every component reads the same source of truth.

## Examples

```typescript
// client/hooks/useAccessibility.ts
import { useReducedMotion } from "react-native-reanimated";
import { AccessibilityInfo } from "react-native";
import { useState, useEffect } from "react";

export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return {
    reducedMotion: reducedMotion ?? false,
    screenReaderEnabled,
  };
}
```

## Why

A single hook ensures every consumer reads the latest reduced-motion and screen-reader state without duplicating the subscription setup. Reduced-motion + screen-reader detection should drive animation skips, haptic suppression, label verbosity, etc.

## Exceptions

When to use:

- Components with animations that should respect reduced motion
- Features that behave differently with screen readers
- Any component needing accessibility context

## Related Files

- `client/hooks/useAccessibility.ts`

## See Also

- [Accessibility-aware haptics pattern](accessibility-aware-haptics-pattern-2026-05-13.md)
- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
