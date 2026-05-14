---
title: "Haptic feedback on user actions — when to fire which impact"
track: knowledge
category: conventions
tags: [react-native, haptics, expo-haptics, ux, feedback]
module: client
applies_to:
  [
    "client/screens/**/*.tsx",
    "client/components/**/*.tsx",
    "client/hooks/**/*.ts",
  ]
created: 2026-05-13
---

# Haptic feedback on user actions — when to fire which impact

## Rule

Provide haptic feedback for meaningful interactions, not for every tap. Match the haptic style to the action's significance.

## Examples

```typescript
import * as Haptics from "expo-haptics";

// Light impact for navigation/selection
const handleItemPress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  navigation.navigate("Detail");
};

// Success notification for completed actions
const handleSave = async () => {
  await saveData();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

// Error notification for failures
const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
```

## Why

Haptics give tactile confirmation of meaningful interactions and signal success/failure without requiring visual attention. Over-use (every tap, scroll, or high-frequency event) creates fatigue and breaks the signal-to-noise ratio.

## Exceptions

When to use: Navigation, successful saves, errors, toggle switches, barcode scan success.

When NOT to use: Every tap, scrolling, or high-frequency interactions.

## See Also

- [Accessibility-aware haptics pattern](../design-patterns/accessibility-aware-haptics-pattern-2026-05-13.md)
- [Pull-to-refresh completion haptics](../design-patterns/pull-to-refresh-completion-haptics-2026-05-13.md)
- [Haptic ownership during component migration](haptic-ownership-during-component-migration-2026-05-13.md)
