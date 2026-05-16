---
title: "RN Modal Cannot Overlay a React Navigation transparentModal"
track: bug
category: logic-errors
tags:
  [
    react-native,
    modal,
    react-navigation,
    transparent-modal,
    ios,
    view-controller,
  ]
module: client
applies_to: ["client/**/*Provider.tsx", "client/screens/**/*.tsx"]
symptoms:
  - "Modal component opens but is invisible on iOS"
  - "User taps a button inside a `transparentModal` screen and nothing appears"
  - "Same Modal works on screens that are NOT React Navigation modals"
created: 2026-04-01
severity: high
---

# RN Modal Cannot Overlay a React Navigation transparentModal

## Problem

An RN `Modal` component rendered from a context provider at the app root opens _behind_ a React Navigation `transparentModal` screen on iOS. The user taps a button inside the `transparentModal`, the `Modal` opens, but it sits underneath the navigation modal and is invisible.

## Symptoms

- iOS only — Android stacks differently and may behave differently
- Modal state is `visible: true`; nothing visible on screen
- Tapping where the modal should be hits the underlying navigation screen

## Root Cause

iOS `presentViewController:` presents on the root view controller. React Navigation's `transparentModal` creates a separate native view controller above the root. The RN `Modal` cannot stack on top of an already-presented native view controller — iOS view-controller presentation is a stack, and the RN Modal gets attached to the parent (root), not the topmost controller.

## Solution

Register the overlay as a `fullScreenModal` screen in the RootStack navigator instead of using an RN `Modal`. Navigation screens stack correctly on top of each other regardless of presentation mode:

```typescript
// Wrong — RN Modal from a context provider
<Modal visible={open}>...</Modal>

// Right — navigate to a registered screen
navigation.navigate("CoachChat", { ... });
```

Where `CoachChat` is registered in the root stack as a `transparentModal` or `fullScreenModal`.

## Prevention

- Never use RN `Modal` or absolute-positioned Views to overlay content on screens that are themselves React Navigation modals (`transparentModal`, `modal`, `formSheet`).
- Use a navigation screen instead. The navigator handles the view-controller stacking.
- This applies to context-provider overlays as much as to inline ones — the rendering location in React doesn't change the iOS view-controller hierarchy.

## Related Files

- Root stack navigator — register overlay as a screen
- `docs/legacy-patterns/react-native.md` — "Modals on top of React Navigation modals" pattern

## See Also

- [Dismiss then navigate modal-to-screen](../design-patterns/dismiss-then-navigate-modal-to-screen-2026-05-13.md)
- [Full-screen detail with transparent modal](../design-patterns/full-screen-detail-transparent-modal-2026-05-13.md)
