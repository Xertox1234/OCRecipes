---
title: "Catch a failed gallery pick on CookSessionCapture"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client]
github_issue:
---

# Catch a failed gallery pick on CookSessionCapture

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/screens/CookSessionCaptureScreen.tsx` (`handlePickFromGallery`) awaits `ImagePicker.launchImageLibraryAsync` with no try/catch. The docs check contradicted the audit's premise (opening the library needs no permission and cancel resolves), so this is defensive hardening against undocumented native failures, matching `ReceiptCaptureScreen.tsx`'s handled picker.

## Acceptance Criteria

- [ ] A rejected picker shows the same user-facing message ReceiptCapture uses and is logged
- [ ] A test drives a rejecting picker

## Implementation Notes

Copy the try/catch shape from `client/screens/ReceiptCaptureScreen.tsx` handlePickFromGallery. Files: `client/screens/CookSessionCaptureScreen.tsx` (+ a new screen test or extracted helper).

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
