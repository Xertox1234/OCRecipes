---
title: "Pinch-to-zoom calls native setZoom and a React state update on every gesture frame with no threshold"
status: in-progress
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance, camera]
github_issue:
---

# Pinch-to-zoom calls native setZoom and a React state update on every gesture frame with no threshold

## Summary

`pinchGesture.onUpdate` calls `scheduleOnRN(setCameraZoom)` (a native `controller.setZoom`) and `scheduleOnRN(showZoomLabel)` (setState plus a timer) on every gesture frame at 60–120Hz on every camera screen.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M4** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/camera/hooks/useCameraFocusAndZoom.ts:179-188` (setZoom :122-150, label :157-163). The codebase already gates bridge crossings elsewhere (`useScrollLinkedHeader.ts:64-70`).
- Research (VisionCamera 5.1.1 "Zooming", installed `Camera.tsx:116-120`, `useZoomUpdater.ts`): `better-fix`. The documented path is a Reanimated SharedValue `zoom` prop bound on the UI thread, which requires `react-native-vision-camera-worklets` (not installed; see the comment at :114-121). The alternative is to epsilon-gate the imperative call.

## Acceptance Criteria

- [ ] Native zoom is applied only when the zoom value changes by more than a small epsilon (or via the SharedValue `zoom` prop, if the worklets package is adopted)
- [ ] The zoom label updates only when its displayed `toFixed(1)` string changes
- [ ] Tests on the pure gating util (e.g. in useCameraFocusAndZoom-utils.ts)
- [ ] Verified on a physical device: pinch is smooth on both platforms
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Prefer the epsilon gate unless adding `react-native-vision-camera-worklets` is independently desired (it is a native dependency, so a dev-client rebuild is required).

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/camera/hooks/useCameraFocusAndZoom.ts`
  - `client/camera/hooks/useCameraFocusAndZoom-utils.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Camera code needs a physical device to verify (Apple-only hardware; Android via emulator is limited).

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M4).
