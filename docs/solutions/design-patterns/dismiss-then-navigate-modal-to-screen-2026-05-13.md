---
title: Dismiss-then-navigate from modal to another screen
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, modal, interaction-manager]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-13'
---

# Dismiss-then-navigate from modal to another screen

## When this applies

When a button inside a modal needs to open a different screen (not a child of the modal), dismiss the modal first with `goBack()`, then use `InteractionManager.runAfterInteractions()` before navigating. Without this, `navigate()` fires against a stale navigator state mid-animation, causing unpredictable behavior.

## Examples

```typescript
import { InteractionManager } from "react-native";

const handleOpenScan = useCallback(() => {
  navigation.goBack(); // dismiss modal
  InteractionManager.runAfterInteractions(() => {
    navigation.navigate("Scan"); // navigate after dismissal completes
  });
}, [navigation]);
```

**Do NOT use `navigation.replace()`** for this pattern. `replace` swaps one screen for another in the stack, but modal-to-modal replacement has undefined presentation behavior — the replacement screen's presentation mode (`fullScreenModal` vs `modal`) may conflict with the replaced screen's animation context.

## Why

React Navigation processes the dismissal animation off the JS thread. Calling `navigate` before the animation completes interleaves two stack transitions and produces visual artifacts (replacement screen flashes briefly, modal jumps). `runAfterInteractions` defers the navigation until the JS thread is idle — which only happens after the dismissal completes.

## Exceptions

When to use: a button inside a modal (Quick Log, settings sheet, etc.) that opens a different root-level screen.

When NOT to use: standard in-stack navigation where `navigate()` or `push()` adds to the current stack.

## Related Files

- `client/screens/QuickLogScreen.tsx` — camera button dismisses Quick Log then opens Scan
- `client/screens/meal-plan/RecipeCreateScreen.tsx` — uses `InteractionManager` for bottom sheet transitions

## See Also

- [navigate() vs replace() in modal flows](../conventions/navigate-vs-replace-modal-flows-2026-05-13.md)
