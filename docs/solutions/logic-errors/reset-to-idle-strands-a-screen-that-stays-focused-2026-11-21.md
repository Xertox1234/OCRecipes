---
title: "A reset that parks a focus-armed state machine at IDLE strands the screen when the user stays on it"
track: bug
category: logic-errors
tags: [react-native, hooks, camera, state-machine, typescript]
module: client
applies_to: ["client/screens/ScanScreen.tsx", "client/camera/reducers/**/*.ts"]
symptoms: ["After Try again or closing a modal, barcode scanning and the shutter do nothing until the screen is reopened", "A screen reader says the camera is still starting forever", "The camera preview stays live while every input is ignored"]
created: '2026-11-21'
severity: high
---

# A reset that parks a focus-armed state machine at IDLE strands the screen when the user stays on it

## Problem

ScanScreen's phase reducer leaves `IDLE` only on `CAMERA_READY`, which only the focus effect dispatches. `resetScan` (cleanup + `RESET` → `IDLE`) was correct for blur, but was also wired to "Try again" on a failed smart photo and to the premium-blocked / locked-intent paths, where the user **stays** on Scan.

## Symptoms

Camera audit 2026-11-21 H1: after "Try again", the preview stayed live but `onBarcodeScanned` ignored every phase but HUNTING/BARCODE_TRACKING and `getCapturePlan(IDLE).capture` was false — scanning and the shutter were dead until the user closed and reopened Scan. Present since `RESET` first became `onRetry`.

## Root Cause

One reset served two intents: "the user left" (stay idle) and "start over here" (re-arm). The arming event was tied to focus, which does not change when the user stays.

## Solution

Separate the two: keep `resetScan` for abandonment and add `rearmScan` for start-over paths:

```ts
const rearmScan = useCallback(() => {
  resetScan();
  if (navigation.isFocused()) { // live read — a late call after leaving stays idle
    hasLockedRef.current = false;
    dispatch({ type: "CAMERA_READY" });
  }
}, [resetScan, navigation, dispatch]);
```

Wire it to retry and to the upsell's `onClose` (not to the moment the upsell opens, so nothing scans behind the modal).

## Prevention

- For any reducer with an arming event tied to focus/mount, check every `RESET` call site: does the user stay on the screen afterwards? If so it needs the re-arm.
- Test the observable outcome after the reset (a second shutter press reaches the upload), not just the cleanup side effect.

## Related Files

- `client/screens/ScanScreen.tsx`
- `client/camera/reducers/scan-phase-reducer.ts`
- `client/screens/__tests__/ScanScreen.test.tsx`

## See Also

- `docs/solutions/logic-errors/stale-response-guard-keyed-on-request-param-misses-same-key-refire-2026-09-28.md`
