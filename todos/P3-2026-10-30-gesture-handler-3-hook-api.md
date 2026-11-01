---
title: "Move the 6 Gesture.* builder calls to gesture-handler 3's hook API"
status: backlog
priority: low
created: 2026-10-30
updated: 2026-10-31
assignee:
labels: [deferred, client]
github_issue:
---

# Move the 6 Gesture.\* builder calls to gesture-handler 3's hook API

## Summary

The Expo SDK 58 upgrade moved react-native-gesture-handler from 2.32 to 3.3 without migrating the old `Gesture.*` builder calls. Move them to the v3 hook API so they stop depending on the legacy compatibility path.

## Background

Deferred on purpose by the SDK upgrade runbook (step 4, task 7). In 3.3, `GestureDetector` hands builder-style gestures to `LegacyGestureDetector` (`node_modules/react-native-gesture-handler/src/v3/detectors/GestureDetector.tsx`), so the builders keep working. The SDK PR stays a dependency move, and the camera's tap-to-focus and pinch-zoom are checked on a device before anything is rewritten.

## Acceptance Criteria

- [ ] The 6 builder calls use the v3 hooks (`useTapGesture`, `usePinchGesture`, `usePanGesture`, and the v3 way of running gestures together in place of `Gesture.Simultaneous`)
- [ ] `useTapGesture`, `usePanGesture` and `usePinchGesture` are added to `WORKLET_CALLBACK_HOOKS` in `scripts/worklet-directive-guard.ts`, with a guard test showing a hook callback is checked
- [ ] Camera tap-to-focus and pinch-zoom, the meal-plan swipe and the toast swipe-to-dismiss still work on a device

## Implementation Notes

Builder calls at the time of the upgrade (`grep -rn 'Gesture\.[A-Z][a-zA-Z]*(' client`):

- `client/camera/hooks/useCameraFocusAndZoom.ts:194` (`Gesture.Tap`), `:198` (`Gesture.Pinch`)
- `client/camera/components/CameraView.tsx:127` and `client/camera/components/CameraView.ios.tsx:149` (`Gesture.Simultaneous`)
- `client/screens/meal-plan/MealPlanHomeScreen.tsx:595` (`Gesture.Pan`)
- `client/components/Toast.tsx:108` (`Gesture.Pan`)

Callbacks that run as worklets need the guard update in the same PR, otherwise the guard stops checking them.

## Scope Contract

- **Mechanisms to use:** gesture-handler 3's own hook API, nothing new
- **Files in scope:** the four client files above, `scripts/worklet-directive-guard.ts` and its test
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- The Expo SDK 58 PR (`chore/sdk-step4-sdk58`) is merged

## Risks

- The camera gestures can only be checked on a physical device (the simulator has no camera)

## Updates

### 2026-10-30

- Filed by the SDK 58 upgrade (runbook step 4, task 7)

### 2026-10-31

- Owner ruling 2026-10-31: the Android device checks for the P3 todos run as ONE owner phone session after the camera and gesture-handler PRs merge (agent drives adb; owner holds the phone, scans a barcode, listens to TalkBack). The executor ships the code and leaves the device-check AC open for that session (iPhone checks for the camera gestures go in the same session).
