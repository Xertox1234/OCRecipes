---
title: "Camera capture and session failures leave no trace in production — errors are swallowed or sent to the dev-only logger.warn"
status: in-progress
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

- [ ] Capture failures, Camera session errors, and barcode-scanner errors are reported via `logger.error`, latched to once per mount to avoid floods
- [ ] User-facing behavior is unchanged (the capture-failed alert still shows)
- [ ] **Decided (user, 2026-09-25): log interruptions only.** `onInterruptionStarted/Ended` are handled on both CameraView variants by reporting to error tracking (latched once per mount, like the failures). No new user-facing UI
- [ ] Tests assert `logger.error` is called once on repeated failures
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
