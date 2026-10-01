---
title: "Pinch-to-zoom calls native setZoom and a React state update on every gesture frame with no threshold"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
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

- [x] Native zoom is applied only when the zoom value changes by more than a small epsilon (or via the SharedValue `zoom` prop, if the worklets package is adopted)
- [x] The zoom label updates only when its displayed `toFixed(1)` string changes
- [x] Tests on the pure gating util (e.g. in useCameraFocusAndZoom-utils.ts)
- [ ] Verified on a physical device: pinch is smooth on both platforms — **left unchecked**, see Updates: no camera-capable simulator/device reachable in this environment
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-25 (resolution)

- Implemented: `client/camera/hooks/useCameraFocusAndZoom-utils.ts` gained two pure,
  worklet-safe gating helpers — `shouldApplyZoom(nextZoom, lastAppliedZoom, epsilon = 0.01)`
  (numeric epsilon compare) and `formatZoomLabel(value)` (`${value.toFixed(1)}x`, the single
  source of truth for the displayed text). `useCameraFocusAndZoom.ts`'s pinch gesture now tracks
  the last-bridged zoom and label text on the UI thread via two new `SharedValue`s
  (`lastAppliedZoom`, `lastZoomLabelText`) and only calls `scheduleOnRN(setCameraZoom, ...)` /
  `scheduleOnRN(showZoomLabel, ...)` when each respectively crosses the epsilon or the displayed
  text changes — mirroring the already-codified pattern in `docs/legacy-patterns/animation.md` ->
  "Gate runOnJS on Shared-Value Transitions, Not on Every Frame" (same shape as
  `useScrollLinkedHeader.ts`'s `lastBarVisible`). `lastZoomLabelText` resets to `null` in
  `.onStart` so a new gesture always shows the live readout at least once even if it ends in the
  same displayed bucket the previous gesture left off in; `lastAppliedZoom` is NOT reset there
  (it tracks native state, not display).
- TDD: 9 new tests written first. 8 of the 9 failed against unmodified `main` (the epsilon/bucket
  gating didn't exist, so every frame bridged). The 9th (a new-gesture label-reset guard) passes
  on unmodified `main` too — `main` has no gating at all, so it also cannot suppress the label
  across a gesture boundary; that test exists to guard the fix's own `.onStart` reset against a
  regression, not to demonstrate the original audit finding. All 31 tests in the two files (9 new
  - 22 existing) pass after the fix. Full suite: 8711/8711 tests, `tsc --noEmit` clean, `eslint`
    clean on the changed files (3 pre-existing warnings elsewhere — `ScanScreen.tsx`,
    `server/storage/__tests__/helpers.test.ts` — untouched by this diff).
- Known, deliberate tradeoff (documented in a code comment above `showZoomLabel`): gating the
  label's hide-timer re-arm on the _displayed_ text changing means holding a pinch steady within
  the same 0.1x bucket for >600ms mid-gesture now lets the label fade before the gesture ends
  (previously it stayed visible for the whole gesture and only started fading once the fingers
  stopped moving). An `.onEnd`-driven hide would avoid this but is a larger change outside this
  todo's scope — flagged for the user's on-device check.
- Acceptance criterion "Verified on a physical device: pinch is smooth on both platforms" is left
  UNCHECKED — no camera-capable simulator or physical device is reachable in this automated
  environment (Apple-only hardware; camera features require a dev-client build). The other four
  criteria are mechanically verified (epsilon and label-bucket gates implemented and unit-tested,
  TDD red/green measured, diff is a straight application of an already-codified pattern), which is
  the "optional device confirmation, otherwise mechanically checkable" exception in
  `docs/solutions/conventions/todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md`
  — not a reason to gate the whole todo on `human_led`. Deferred to the user's on-device check,
  alongside the hide-timer tradeoff above.
- Reviewed by `code-reviewer` + `mobile-reviewer` (branch review): both returned clean, zero
  blocking findings. `mobile-reviewer` independently traced the gating arithmetic and all three
  new hook-level tests frame-by-frame, confirmed the `.onStart` reset reasoning (native state vs.
  display state), and agreed leaving AC4 unchecked is appropriate rather than a `human_led` gate.
  `code-reviewer` additionally ran the hook's existing `CameraView`/`CameraView.ios` consumer
  tests and the `worklet-directive-guard` suite to rule out collateral breakage — all green. One
  non-blocking suggestion (add this dated Updates entry) — addressed by this entry.

### 2026-09-25 (review repair)

- Independent review found two regressions from gating: the final zoom of a pinch could stay unapplied (last frame within the epsilon), and the zoom label faded mid-gesture when held steady. Added `pinchGesture.onFinalize` (one bridge call per gesture): it flushes a held-back final zoom and starts the label's 600ms hide; `showZoomLabel` now only cancels a pending hide. Tests cover both, plus no extra `setZoom` for an idle or already-applied pinch. The solution doc gained this rule and no longer lists `useScrollLinkedHeader.ts` in `applies_to`.
- Confirmation review: `onFinalize` also fires for a pinch attempt that never activates (on Android a tap drives the pinch recognizer BEGAN→FAILED), and with the label gate reset only in `onStart`, every tap after a pinch re-armed the hide. The gate now resets in `onBegin`; a test drives begin+finalize with no start and asserts no timer and no extra setZoom. The shared gesture-handler mock and ScanScreen's inline mock gained `onBegin`.
- Next confirmation review: on iOS a one-finger tap takes the pinch recognizer from possible straight to failed, so `onFinalize` fires with no `onBegin`. The gate now also clears itself inside `onFinalize` once used; a test drives a bare `onFinalize` after a real pinch and asserts no timer.
- Final confirmation review: code correct across all five traced scenarios. The doc now makes the point-of-use clear in `onFinalize` the primary rule (it is what the fix depends on), with `onBegin` as defence in depth, and marks the iOS one-finger-tap event sequence as source-read and disputed, not device-verified. Added a test for a second pinch starting before the first pinch's hide fires (fails if `showZoomLabel` stops clearing the pending timer).
