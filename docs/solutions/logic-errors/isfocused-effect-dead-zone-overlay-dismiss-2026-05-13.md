---
title: isFocused effect dead zone — in-screen overlays don't trigger focus re-entry
track: bug
category: logic-errors
module: client
severity: high
tags: [react-navigation, focus, useeffect, camera, overlays]
symptoms: [Scanner remains permanently blocked after dismissing an in-screen overlay, useEffect on `isFocused` never re-runs when overlay closes on the same focused screen, Reset/re-initialize logic relies on `isFocused` but the screen stayed focused]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-02'
---

# isFocused effect dead zone — in-screen overlays don't trigger focus re-entry

## Problem

A `useEffect` that depends on `isFocused` only fires when focus _transitions_ (gained or lost). It does **not** re-fire when the user dismisses an overlay while the screen remains focused.

`ScanScreen` dispatched `RESET` and relied on the `isFocused` effect to re-initialize `hasLockedRef` and dispatch `CAMERA_READY`. When the user dismissed the confirm overlay (still on the same focused screen), `isFocused` stayed `true` — the effect never re-ran — and the scanner was permanently blocked.

## Symptoms

- Scanner refuses to scan again after closing a confirm overlay
- `hasLockedRef.current` remains `true` after the overlay dismisses
- Re-entering the screen via navigation transitions works fine; only same-screen overlay dismiss is broken

## Root Cause

`useIsFocused()` exposes a boolean that changes only on navigation focus transitions. Effects that depend on `[isFocused]` re-run only when that boolean toggles. In-screen overlays don't change the focus state, so the effect never re-fires.

```typescript
// This effect fires on focus TRANSITIONS only — not on overlay dismiss
useEffect(() => {
  if (isFocused) {
    hasLockedRef.current = false; // never re-runs if screen stays focused
    dispatch({ type: "CAMERA_READY" });
  }
}, [isFocused]);

// Bad — relies on isFocused effect re-running — doesn't work for in-session resets
const handleConfirmDismiss = useCallback(() => {
  setConfirmCard(null);
  dispatch({ type: "RESET" }); // hasLockedRef.current stays true
}, []);
```

## Solution

Re-initialize imperatively in the dismiss handler:

```typescript
// Good — reset in the dismiss handler itself
const handleConfirmDismiss = useCallback(() => {
  setConfirmCard(null);
  hasLockedRef.current = false;
  dispatch({ type: "CAMERA_READY" });
}, []);
```

## Prevention

Any "reset and re-initialize" that must happen while the screen stays focused (e.g., dismissing an overlay, completing a sub-flow) must be done **imperatively in the event handler**. Never rely on a `isFocused` effect to do it — that effect is for navigation transitions, not in-session state resets.

## Related Files

- `client/screens/ScanScreen.tsx` — `handleConfirmDismiss`
- Audit 2026-05-02 C1

## See Also

- [Camera isActive include overlay state](../conventions/camera-isactive-include-overlay-state-2026-05-13.md)
