---
title: "Camera leftovers: takePicture options ignored; Android interruption logging"
status: backlog
priority: low
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, camera]
github_issue:
---

# Camera leftovers: takePicture options ignored; Android interruption logging

## Summary

Two small camera inconsistencies from the pre-launch audit.

## Background

Audit findings L-cam-3, L-cam-6. (1) `CameraView.takePicture` ignores its options (`_options` unused in `client/camera/components/CameraView.tsx` and `.ios.tsx`), so ReceiptCaptureScreen's `quality: 0.85, skipProcessing` do nothing. (2) The Android CameraView logs the routine app-backgrounded interruption at error level with one shared latch per mount; iOS skips it and latches per reason (`docs/solutions/logic-errors/visioncamera-interruption-reports-app-backgrounding-latch-per-reason-2026-09-25.md`).

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] takePicture honours its options or the options are removed from call sites
- [ ] Android interruption handling matches iOS (skip routine background, latch per reason)
- [ ] Device check on Android

## Implementation Notes

Read the VisionCamera patch notes before changing CameraView.

## Scope Contract

- **Files in scope:** `client/camera/components/CameraView.tsx`, `client/camera/components/CameraView.ios.tsx`, `client/screens/ReceiptCaptureScreen.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
