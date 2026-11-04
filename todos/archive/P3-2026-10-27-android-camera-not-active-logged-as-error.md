---
title: "Android: CameraX 'Camera is not active' at scan-screen start is logged as an error (Sentry noise)"
status: done
priority: low
created: 2026-10-27
updated: 2026-10-31
assignee:
labels: [deferred, camera, android]
github_issue:
---

# Android: "Camera is not active" at scan start is logged as an error

## Summary

Opening the scan screen on an Android phone logged `[CameraView] Camera error Error: androidx.camera.core.CameraControl$OperationCanceledException: Camera is not active.` while the camera was in fact running. In dev it raises the red LogBox overlay; in production `logger.error` forwards it to Sentry as a false error.

## Background

Seen on a Samsung Galaxy A37, Android 16, dev build, 2026-10-27. `dumpsys media.camera` showed `com.ocrecipes.app` holding camera 0 (state active) at the same moment, and the scan screen kept working. CameraX throws `OperationCanceledException` when a camera-control call (torch, focus, zoom) is issued before or while the session is not active; it is a start-up race, not a failure. `client/camera/components/CameraView.tsx` `onError` logs every first error at `logger.error` level (~line 202). It appeared on every scan-screen open observed that evening (4 of 4, default and label mode), so in production it would be a Sentry event per Android scan. The noise has a cost: on 2026-10-27 the red overlay covered the "Could not analyze this photo" toast of a real upload failure (the expo/fetch FormData bug), so the tester saw only the camera error.

## Acceptance Criteria

- [x] (dropped by owner 2026-10-31) Find which call raises it on start (torch updater, focus, zoom) — logcat with the full stack (`adb logcat | grep -i camerax`).
- [x] A CameraX `OperationCanceledException` / "Camera is not active" is logged at `warn`, not `error` (no Sentry event, no LogBox overlay); other camera errors still go to `logger.error`.
- [x] Test covers both branches of the `onError` classification.

## Implementation Notes

- File in scope: `client/camera/components/CameraView.tsx` (`onError`), its test.
- Keep the once-per-mount guard (`cameraErrorReportedRef`); don't let a benign cancel use up the one report a real error needs.

## Scope Contract

- **Files in scope:** `client/camera/components/CameraView.tsx` and its `__tests__`.
- No change to the VisionCamera patch.

## Updates

### 2026-10-27

- Filed from the Android modal-toast check (dev overlay on opening Scan).

### 2026-10-29

- Implemented AC #2 and #3: `isBenignCameraCancel` in `CameraView.tsx` routes `OperationCanceledException` / "Camera is not active" to `logger.warn` (own once-per-mount latch; the error latch is untouched). Two tests added.
- AC #1 (which call raises it, via `adb logcat` stack) NOT done: the phone was in use by another agent. The fix classifies by exception class/message, so it does not depend on the answer. Todo kept open (not archived) for the logcat check.

### 2026-10-31

- Owner ruling: AC #1 (which CameraX call raises it) DROPPED — the fix classifies by exception class/message, so it does not depend on the answer. Archived.
