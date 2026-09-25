---
title: VisionCamera's onInterruptionStarted fires on ordinary app backgrounding (iOS) — a single shared latch reports a non-failure and hides the next real interruption
track: bug
category: logic-errors
tags: [react-native, camera, observability, sentry]
module: camera
applies_to: ["client/camera/components/CameraView*.tsx"]
symptoms: ["Sentry fills with 'Camera session interrupted (video-device-not-available-in-background)' from normal use", "A real interruption (system pressure, device in use) never reaches Sentry after the user once pressed Home mid-scan"]
created: 2026-09-25
severity: medium
---

# VisionCamera's onInterruptionStarted fires on ordinary app backgrounding (iOS) — a single shared latch reports a non-failure and hides the next real interruption

## Problem

PR #1074 reported `onInterruptionStarted` to error tracking behind one once-per-mount boolean latch. On iOS that callback is not a failure signal: `react-native-vision-camera@5.1.1`'s `HybridCameraSession.swift` (`addOnInterruptionStartedListener`) forwards **every** `AVCaptureSession.wasInterruptedNotification` unfiltered, including `video-device-not-available-in-background`, which AVFoundation posts whenever the app backgrounds with the session running (Home, incoming call, Control Center). `ScanScreen`'s `isActive={isFocused && !confirmCard}` has no `AppState` gate, so this reaches JS in normal use.

## Root Cause

Two defects compound:
1. The routine background reason was reported as an error (noise).
2. Because it is the statistically likeliest FIRST interruption, the single shared latch then suppressed every later, diagnostic reason (`…due-to-system-pressure`, `…in-use-by-another-client`, `sensitive-content-mitigation-activated`) for the rest of the mount.

## Solution

- Skip `video-device-not-available-in-background` entirely. The end callback carries no reason, so pair ends with REPORTED starts: set an "awaiting end" flag when a start is reported and report the end only while it is set. Do not key the end on "was the last start the background one": AVFoundation can post a second, changed-reason notification mid-episode, so real → background → end would drop the real episode's end.
- Latch **per reason** (`useRef(new Set<string>())`), not one boolean for the whole callback.
- Android is different: CameraX only raises this path for a `RECOVERABLE` `CameraState.ErrorType` and always reports `unknown`, so one latch is fine there.
- The iOS tests pin the forwarded payload (`toHaveBeenCalledWith`), not just the call count. A count-only assertion stays green if a refactor drops the error that made it into Sentry. (The Android file still pins only the end message.)

## Prevention

Before routing a native "event" callback to error tracking, read the native passthrough to list which values are routine. A latch is only as good as its key: if the callback carries a discriminator (reason, code), latch on it.

## Related Files

- `client/camera/components/CameraView.ios.tsx`
- `client/camera/components/CameraView.tsx`
- `node_modules/react-native-vision-camera/ios/Hybrid Objects/HybridCameraSession.swift`

## See Also

- [js-rendered-feedback-not-evidence-native-call-succeeded](../conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) — why camera failures are reported at all
