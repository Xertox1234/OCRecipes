---
title: "iOS: VoiceOver check of the FullWindowOverlay toast host on a real iPhone — the simulator cannot run VoiceOver, and Maestro's accessibility tree no longer sees the toast"
status: done
priority: medium
created: 2026-10-04
updated: 2026-10-04
assignee:
labels: [deferred, accessibility, ios, react-native]
github_issue:
human_led: true
---

# iOS: VoiceOver check of the FullWindowOverlay toast host on a real iPhone

## Summary

#1257 moved the iOS toast host into a `FullWindowOverlay` so toasts show above native-stack modals. Its VoiceOver criterion could not run: the iOS Simulator has no VoiceOver. Check on a physical iPhone that a toast is still spoken and that its action button is reachable.

## Background

- The simulator pass for #1257 (2026-10-04, iPhone 17 Pro, iOS 26.5) proved the visual and touch behaviour: the toast shows above Scan (it was hidden there on `main`), swipe-up dismisses it, taps outside the strip pass through, and the action button fires.
- One warning sign: with the overlay in place, Maestro's accessibility hierarchy no longer contains the toast (it did on `main`), and Maestro's `takeScreenshot` can miss it too. The overlay's container is added straight to the key window (`node_modules/react-native-screens/ios/RNSFullWindowOverlay.mm`, `show`/`maybeShow`), outside the React root view. That may only be a Maestro limitation, or VoiceOver may not reach the toast's action.
- `unstable_accessibilityContainerViewIsModal={false}` is set in `client/context/ToastContext.tsx`, so VoiceOver should still reach the screen under the toast.
- Human-led: it needs the owner's physical iPhone with VoiceOver on. An agent cannot observe VoiceOver output.

## Acceptance Criteria

- [x] On a physical iPhone with VoiceOver on, a toast raised on a tab screen is announced.
- [x] VoiceOver can move focus to the toast's action button (e.g. "Open") and activate it.
- [x] A toast raised while a native-stack modal (Scan or LabelAnalysis) is up is announced, and its action is reachable.
- [x] While the toast is up, VoiceOver can still reach the controls of the screen underneath.
- [x] Record whether focus jumps to the toast when it mounts (the overlay posts `UIAccessibilityLayoutChangedNotification`), and whether it is spoken twice.
- [x] If any of the above fails, file a fix todo with the observed behaviour; if all pass, archive this todo.

## Implementation Notes

- Trigger: the Coach "reply finished while away" toast (`client/navigation/MainTabNavigator.tsx`, `CoachReplyToastBridge`) needs a free-tier account (3 Coach messages a day, `shared/types/premium.ts`). The LabelAnalysis Retry toast (`client/screens/LabelAnalysisScreen.tsx`) needs a failed upload.
- The action toast lives 10 s when a screen reader is on (`SCREEN_READER_ACTION_DISMISS_MS`, `client/components/Toast.tsx`).

## Scope Contract

- **Mechanisms to use:** a manual device check only; a fix, if needed, goes in its own todo.
- **Files in scope:** this todo file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1257 merged and on the device (dev build or OTA).

## Risks

- If VoiceOver cannot reach the overlay, every toast's action becomes unreachable for VoiceOver users on iOS, not just on modal screens.

## Updates

### 2026-10-04

- Filed from the #1257 simulator verification (owner present); the owner chose to merge #1257 and check VoiceOver on device afterwards.

### 2026-10-04 (device check)

- Owner ran the VoiceOver check on a physical iPhone and reported that every acceptance criterion passed: the toast is announced on tab screens and over native-stack modals, its action button can be focused and activated, and the screen underneath stays reachable. No focus-jump or double-announcement problem was reported. So Maestro's missing toast was a Maestro limit, not a VoiceOver gap. No fix todo needed; archived.
