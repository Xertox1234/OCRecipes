---
title: "Move compressImage off the deprecated manipulateAsync"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client, dependencies]
github_issue:
---

# Move compressImage off the deprecated manipulateAsync

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/lib/image-compression.ts:3, 75` uses `manipulateAsync`, which the Expo ImageManipulator docs mark deprecated in favour of the contextual API (`ImageManipulator.manipulate(uri).resize(...).renderAsync()` then `saveAsync({ compress, format })`). Works today; will break when Expo removes it.

## Acceptance Criteria

- [ ] compressImage uses the contextual API with the same resize/quality/target-size behaviour
- [ ] image-compression tests and the upload hooks' tests stay green
- [ ] Both platforms checked on device (resize + JPEG output)

## Implementation Notes

Keep the adaptive second pass and first-pass cleanup. Files: `client/lib/image-compression.ts`, `client/lib/__tests__/image-compression*.test.ts`.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
