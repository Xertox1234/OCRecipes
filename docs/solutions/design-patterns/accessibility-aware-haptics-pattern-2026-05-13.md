---
title: "Accessibility-aware haptics — disable when reduced motion is preferred"
track: knowledge
category: design-patterns
tags: [react-native, haptics, accessibility, reduced-motion, hooks]
module: client
applies_to:
  [
    "client/hooks/useHaptics.ts",
    "client/components/**/*.tsx",
    "client/screens/**/*.tsx",
  ]
created: 2026-05-13
---

# Accessibility-aware haptics — disable when reduced motion is preferred

## When this applies

Wrap haptic feedback to automatically disable when the user has reduced motion enabled. Users who enable reduced motion often want reduced sensory feedback overall.

## Examples

```typescript
// client/hooks/useHaptics.ts
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { useAccessibility } from "./useAccessibility";

export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (
      style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
    ) => {
      if (!reducedMotion) {
        Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) {
        Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (!reducedMotion) {
      Haptics.selectionAsync();
    }
  }, [reducedMotion]);

  return { impact, notification, selection, disabled: reducedMotion };
}
```

### Usage

```typescript
const haptics = useHaptics();

const handlePress = () => {
  haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  // ... action
};
```

## Why

Users who enable reduced motion often want reduced sensory feedback overall. The hook keeps call sites unchanged (just call `haptics.impact()` as usual) while respecting the user preference globally.

## Related Files

- `client/hooks/useHaptics.ts`
- `client/hooks/useAccessibility.ts`

## See Also

- [Haptic feedback on user actions](../conventions/haptic-feedback-on-user-actions-2026-05-13.md)
- [useAccessibility hook pattern](use-accessibility-hook-pattern-2026-05-13.md)
- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
