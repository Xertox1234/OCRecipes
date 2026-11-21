---
title: "Shutter looks armed but ignores taps while an earlier classification upload is still out"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client]
github_issue:
---

# Shutter looks armed but ignores taps while an earlier classification upload is still out

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/screens/ScanScreen.tsx` keeps `isCapturingRef` true for the whole `uploadPhotoForAnalysis(photoUri, "auto")` call in captureSmart (~:633-660), which takes no AbortSignal. If the user leaves and returns (blur resets to HUNTING) while it is outstanding, the shutter shows armed but silently no-ops until the upload settles.

## Acceptance Criteria

- [ ] Leaving Scan aborts (or detaches) the in-flight classification and releases the capture guard
- [ ] Returning shows a shutter that works on the first tap
- [ ] ScanScreen test covers leave-and-return mid-upload

## Implementation Notes

Pass an AbortSignal to `uploadPhotoForAnalysis` (it already accepts one) from a controller aborted on blur, and reset `isCapturingRef` on abort. Files: `client/screens/ScanScreen.tsx`, its test.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
