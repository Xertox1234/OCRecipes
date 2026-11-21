---
title: "Batch scan adds 1 to an item's quantity every 2 s while its barcode stays in view"
status: backlog
priority: low
created: 2026-11-21
updated: 2026-11-21
assignee:
labels: [deferred, camera, client, product-decision]
github_issue:
---

# Batch scan adds 1 to an item's quantity every 2 s while its barcode stays in view

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/camera/hooks/useCamera.ts:77-110` re-arms the 2 s repeat window on every repeat (`scannedBarcodesRef.set(now)`), and `client/screens/BatchScanScreen.tsx:79-86` increments quantity each time with an "Item already scanned" announcement. Documented as intended, but a user pausing on one product gets quantity 3+ with no way to tell a deliberate rescan from dwell. Needs an owner decision on the intended behaviour before any code change.

## Acceptance Criteria

- [ ] Owner decides: require the code to leave the frame before a rescan counts, a longer window, or keep as is
- [ ] If changed: useCamera batch-mode tests cover dwell vs. a deliberate rescan

## Implementation Notes

Option A: count a repeat only after the barcode has been absent for N frames/ms. Option B: lengthen the window. Files: `client/camera/hooks/useCamera.ts`, `client/screens/BatchScanScreen.tsx` and their tests.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)
