---
title: "setCameraZoom still swallows its rejection in an empty .catch()"
status: backlog
priority: low
created: 2026-07-25
updated: 2026-07-25
assignee:
labels: [deferred, camera, react-native]
github_issue:
---

# setCameraZoom still swallows its rejection in an empty .catch()

## Summary

`setCameraZoom` in `client/camera/hooks/useCameraFocusAndZoom.ts` still ends in
`.catch(() => {})`, the exact pattern PR #716 removed from `runFocus` in the
same file — and which the review rule that PR added to `mobile-reviewer.md` now
explicitly flags.

## Background

Deferred from the PR #716 review (both `code-reviewer` and `mobile-reviewer`
raised it independently, each as a SUGGESTION). It was left out of #716 to keep
that change minimal and because it is pre-existing, not a regression.

The failure mode is the same one #716 fixed one function above it:

```ts
cameraRef.current?.controller?.setZoom(value).catch(() => {
  // Camera not ready yet / setZoom rejected — next gesture update
  // (or the label, which already reflects the intended value) is the
  // recovery; nothing user-facing to surface here.
});
```

The zoom label is JS state and keeps showing the intended value, so if
`setZoom` starts failing _persistently_ rather than transiently, the readout
reports a zoom level the hardware never applied — a JS-rendered affordance
lying about a native call, which is exactly the pattern codified in
`docs/solutions/conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md`.

Lower stakes than the focus bug: the comment's reasoning (the next pinch update
retries) is genuinely true for the transient case, and a stuck zoom is far more
visible to the user than a stuck focus. Hence low priority, not medium.

## Acceptance Criteria

- [ ] `setCameraZoom`'s rejection reaches `logger.error` rather than being discarded
- [ ] Reporting is latched so a pinch gesture (which fires `setZoom` per frame via
      `runOnJS`) cannot flood Sentry — note this is a much higher call rate than
      the tap handler `runFocus` was latched for
- [ ] The latch re-arms on a successful `setZoom`, matching the `runFocus` precedent,
      so a transient early rejection does not permanently suppress reporting
- [ ] Test coverage in `client/camera/hooks/__tests__/useCameraFocusAndZoom.test.ts`
      mirroring the existing focus failure-reporting cases

## Implementation Notes

- Follow the shape already in `runFocus` (same file): `.then()` re-arm +
  latched `.catch()` with `logger.error`.
- `setZoom` is called from the pinch `.onUpdate` worklet via `runOnJS` on
  **every frame**, so an unlatched `logger.error` would be dramatically worse
  here than it would have been for focus. The latch is mandatory, not optional.
- Consider whether the log message should include `device.minZoom`/`maxZoom`
  and the requested value, the way the focus message includes the metering flags.
- Do NOT convert zoom to the declarative `<Camera zoom={...}>` prop while doing
  this — that path throws without `react-native-vision-camera-worklets` and
  kills the whole preview. See
  `docs/solutions/runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md`.

## Scope Contract

- **Mechanisms to use:** the existing latched-`logger.error` pattern from
  `runFocus` in the same file. No new abstraction, no shared error helper.
- **Files in scope:** `client/camera/hooks/useCameraFocusAndZoom.ts`,
  `client/camera/hooks/__tests__/useCameraFocusAndZoom.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #716 is merged and provides the pattern to copy.

## Risks

- Getting the latch wrong here is worse than for focus because of the
  per-frame call rate — verify with a test that drives multiple pinch updates,
  not just one.

## Updates

### 2026-07-25

- Initial creation. Deferred from the PR #716 review; raised independently by
  both `code-reviewer` and `mobile-reviewer`.
