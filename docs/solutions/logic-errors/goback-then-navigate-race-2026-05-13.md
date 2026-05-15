---
title: "goBack() then navigate() in the same tick races the navigator state"
track: bug
category: logic-errors
tags: [react-navigation, modal, dismiss, navigation, race-condition]
module: client
applies_to: ["client/screens/**/*Modal*.tsx"]
symptoms:
  - "Modal dismiss animation half-plays before the next screen pushes"
  - "Second navigation is ignored or pushes onto a stale stack"
  - "Replacement screen appears with wrong presentation mode"
created: 2026-03-21
severity: medium
---

# goBack() then navigate() in the same tick races the navigator state

## Problem

Quick Log had a "Scan barcode" shortcut that needed to dismiss the modal and open the Scan screen. The initial implementation called `navigation.goBack()` immediately followed by `navigation.navigate("Scan")`. The second call fired against a navigator state where the modal had not yet finished dismissing, producing inconsistent behavior.

## Symptoms

- Visual artifact: dismiss animation truncated
- Sometimes the navigate is dropped silently
- Presentation mode of the target screen looks wrong (modal vs full-screen)

## Root Cause

`goBack()` schedules a dismissal but does not wait for it. React Navigation processes the second `navigate()` against the still-mounted modal state, so the new screen pushes into a transitional navigator.

```tsx
// Bad — second call races the dismiss
navigation.goBack();
navigation.navigate("Scan"); // navigator state is stale
```

## Solution

Defer the second navigation until after the current interaction completes:

```tsx
import { InteractionManager } from "react-native";

navigation.goBack();
InteractionManager.runAfterInteractions(() => {
  navigation.navigate("Scan");
});
```

## Prevention

- Never chain `goBack()` and `navigate()` synchronously. Always use `runAfterInteractions` (or a `setTimeout(_, 0)` fallback).
- Avoid `navigation.replace()` for cross-modal transitions when the source and target have different `presentation` modes.
- Two explicit steps beat one clever one.

## Related Files

- `client/screens/QuickLogScreen.tsx`
- `docs/patterns/react-native.md` — "Dismiss-then-Navigate" pattern

## See Also

- [Navigate vs replace for modal flows](../conventions/navigate-vs-replace-modal-flows-2026-05-13.md)
