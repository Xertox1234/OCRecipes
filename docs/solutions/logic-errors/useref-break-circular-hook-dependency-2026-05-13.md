---
title: useRef to Break Circular Hook Dependency
track: bug
category: logic-errors
module: client
severity: medium
tags: [hooks, useCallback, useRef, memoization, scan-screen, circular-dependency]
symptoms: [TypeScript 'used before declaration' on a callback that depends on a hook's return value, Callback memoization breaks because a dependency is the very function returned by the hook that takes the callback as input, Native barcode scanner re-registers on every render because callback identity changes]
applies_to: [client/screens/ScanScreen.tsx, client/camera/hooks/useCamera.ts]
created: '2026-04-18'
---

# useRef to Break Circular Hook Dependency

## Problem

`ScanScreen` wanted to memoize `onBarcodeScanned` with `useCallback` to prevent the native barcode scanner from re-registering on every render. The callback was passed to `useCamera()`, which returned `resetScanning`. The callback needed `resetScanning` to clear debounce state after navigation. Direct dependency would create a circular loop: the callback depends on a value that depends on the callback.

## Symptoms

- TypeScript reports "used before declaration" when the callback is declared before the hook call that produces its dependency
- Adding the hook's return value to the `useCallback` dependency array breaks memoization on every render where identity changes
- Native scanner debounce state is never reset after navigation, or scanner re-registers continuously

## Root Cause

The hook's API has the callback as input and a helper as output, but the callback's body needs the helper. There is no declaration order that satisfies both directions. Even when the returned helper is stable in practice (`useCallback([], [])` inside the hook), the type system and React's dependency-array contract can't know that.

## Solution

Hold the latest helper in a `useRef`. The ref object identity is stable, so the `useCallback` can close over it without listing it as a dependency. The ref's `.current` is updated synchronously on every render via a plain assignment after the hook call:

```typescript
// 1. Stable ref initialized to a no-op
const resetScanningRef = useRef<() => void>(() => {});

// 2. Memoized callback — closes over the ref object, not the function
const onBarcodeScanSuccess = useCallback(
  async (result: BarcodeResult) => {
    // ... animation ...
    setTimeout(() => {
      resetScanningRef.current(); // always the latest resetScanning
    }, RESET_DELAY_MS);
  },
  [
    /* other stable deps — resetScanningRef intentionally omitted */
  ],
);

// 3. Pass memoized callback to the hook
const { resetScanning } = useCamera({ onBarcodeScanned: onBarcodeScanSuccess });

// 4. Keep the ref current — runs during render, before any effects
resetScanningRef.current = resetScanning;
```

The assignment in step 4 is intentional: it executes on every render (before effects flush) so the ref is in sync by the time any subsequent code, effect, or async callback reads it.

## Prevention

- When hook A's return value is needed inside a callback that is itself an input to hook A, use a ref to hold the returned value. Ref object identity is stable; `.current` is updated synchronously on render.
- Do NOT put the ref in the `useCallback` dependency array. It's stable by definition; adding it would only trigger a lint warning.
- Declare any `useSharedValue` / `useSuccessFlash` / hook calls referenced inside the `useCallback` BEFORE the `useCallback` to avoid "used before declaration."

## Related Files

- `client/screens/ScanScreen.tsx` — `onBarcodeScanSuccess` + `resetScanningRef`
- `client/camera/hooks/useCamera.ts` — the hook that creates the circular dependency

## See Also

- [useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
- [Dirty-state sync ref callbacks](../design-patterns/dirty-state-sync-ref-callbacks-2026-05-13.md)
