---
title: "Give photo uploads real cancellation with expo-file-system's File.upload"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client, dependencies]
github_issue:
---

# Give photo uploads real cancellation with expo-file-system's File.upload

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/lib/photo-upload.ts` uses legacy `uploadAsync` (import at :2; calls at the four upload functions) and only cooperatively checks `signal`; the comment at ~:135 says uploadAsync takes no AbortSignal. The installed expo-file-system 58 ships `File.upload(url, { signal })` / `createUploadTask` (node_modules/expo-file-system/build/File.d.ts:203,227), which cancels natively. Non-2xx still resolves with status and body, so the camera audit's M4 session-expiry check carries over.

## Acceptance Criteria

- [ ] The four upload functions use File.upload with the caller's signal
- [ ] Aborting cancels the native upload (verified on device)
- [ ] photo-upload tests updated; the M4 session-expiry tests still pass

## Implementation Notes

Files: `client/lib/photo-upload.ts`, `client/lib/__tests__/photo-upload.test.ts`, `test/mocks/expo-file-system*`.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
