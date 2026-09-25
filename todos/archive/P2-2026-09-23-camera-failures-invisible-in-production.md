---
title: "Camera capture and session failures leave no trace in production — errors are swallowed or sent to the dev-only logger.warn"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
assignee:
labels: [deferred, audit, camera, observability]
github_issue:
---

# Camera capture and session failures leave no trace in production — errors are swallowed or sent to the dev-only logger.warn

## Summary

`takePicture` discards native capture rejections with a bare `catch { return null; }`, and the Camera/barcode-scanner `onError` overrides replace VisionCamera's default `console.error` with `logger.warn`, which does nothing in production. Field camera failures never reach Sentry.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M6** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/camera/components/CameraView.tsx:139-141` (scanner onError), :144-158 (takePicture), :186-188 (Camera onError); `CameraView.ios.tsx:172-186`, :212-214.
- `client/lib/logger.ts:24-35`: `warn` is `__DEV__`-only; only `error` forwards to `reportError`.
- Research (VisionCamera 5.1.1: native rejects in `HybridCameraPhotoOutput.swift`; default `onError = console.error` in `useCamera.ts:201-203`; "Interruptions" docs): `confirmed`. `onInterruptionStarted/Ended` are unhandled.
- A correct latched pattern already exists: `useCameraFocusAndZoom.ts` `focusFailureReportedRef`. Rule: `docs/solutions/conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md`.

## Acceptance Criteria

- [x] Capture failures, Camera session errors, and barcode-scanner errors are reported via `logger.error`, latched to once per mount to avoid floods
- [x] User-facing behavior is unchanged (the capture-failed alert still shows)
- [x] **Decided (user, 2026-09-25): log interruptions only.** `onInterruptionStarted/Ended` are handled on both CameraView variants by reporting to error tracking (latched once per mount, like the failures). No new user-facing UI
- [x] Tests assert `logger.error` is called once on repeated failures
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Apply the same change to both CameraView variants. The jscpd duplicate between them is tracked separately — don't merge the files here.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/camera/components/CameraView.tsx`
  - `client/camera/components/CameraView.ios.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Sentry noise: a latched once-per-mount report keeps the volume sane.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M6).

### 2026-09-25

- **Product decision (user):** log camera interruptions to error tracking; show users nothing new. Ready for `/todo`.

### 2026-09-25 (resolution)

- Implemented in both `CameraView.tsx` (Android) and `CameraView.ios.tsx` (iOS): a hard
  (non-re-arming), once-per-mount `useRef(false)` latch per failure class — `takePicture`
  rejection, `Camera` `onError`, barcode-scanner `onError` (Android only —
  `useObjectOutput` on iOS has no `onError`), `onInterruptionStarted`, `onInterruptionEnded`
  — each reporting via `logger.error` instead of the dev-only `logger.warn`/bare swallow, so
  failures now reach Sentry via `client/lib/reporter.ts` in preview/production builds.
  `takePicture` still resolves `null` on failure, so the existing `Alert.alert("Capture
failed", ...)` at each call site (ScanScreen.tsx, ReceiptCaptureScreen.tsx,
  CookSessionCaptureScreen.tsx) is unchanged.
- TDD: 11 new tests written first and confirmed failing on `main` (0 calls / undefined props),
  then made to pass by the implementation. Full suite: 23/23 tests pass in the two CameraView
  test files; 8698/8698 project-wide; `tsc --noEmit` and `eslint` both clean.
- Short-circuited research onto the matched solution
  `docs/solutions/conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md`
  (tight GLOB MATCH on `client/camera/**/*.tsx`) — its Rule (`logger.error`, never
  `logger.warn`/`logger.info`, for release/OTA-build visibility) is exactly what this todo
  applies; its Exceptions section ("latch it hard, once per mount") is why these latches
  deliberately do NOT re-arm, unlike `useCameraFocusAndZoom.ts`'s `focusFailureReportedRef`.
- Reviewed by `code-reviewer` + `mobile-reviewer` (branch review): both returned clean, zero
  findings — each independently verified `onInterruptionStarted`/`onInterruptionEnded` are
  real VisionCamera 5.1.1 `CameraProps` (not a new mechanism), that the Android-only
  scanner latch is correctly scoped (`useObjectOutput` has no `onError`), and that the
  `takePicture` null-return contract is unchanged at all three call sites.

### 2026-09-25 (review repair)

- Independent review found iOS forwards app backgrounding (`video-device-not-available-in-background`) through `onInterruptionStarted`. Repaired: that reason and its matching end are not reported, interruptions latch per reason, the end message is neutral, and tests pin the Sentry payload and cover a remount. Codified in `docs/solutions/logic-errors/visioncamera-interruption-reports-app-backgrounding-latch-per-reason-2026-09-25.md`.
