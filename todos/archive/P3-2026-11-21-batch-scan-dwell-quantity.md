---
title: "Batch scan adds 1 to an item's quantity every 2 s while its barcode stays in view"
status: done
priority: low
created: 2026-11-21
updated: 2026-11-22
assignee:
labels: [deferred, camera, client]
github_issue:
---

# Batch scan adds 1 to an item's quantity every 2 s while its barcode stays in view

## Summary

Camera audit 2026-11-21 finding, deferred at triage by the owner. Source: `docs/audits/2026-11-21-camera.md` (local manifest).

## Background

`client/camera/hooks/useCamera.ts:77-110` re-arms the 2 s repeat window on every repeat (`scannedBarcodesRef.set(now)`), and `client/screens/BatchScanScreen.tsx:79-86` increments quantity each time with an "Item already scanned" announcement. Documented as intended, but a user pausing on one product gets quantity 3+ with no way to tell a deliberate rescan from dwell. Needs an owner decision on the intended behaviour before any code change.

## Acceptance Criteria

- [x] In batch mode a barcode that stays in view is counted once; it counts again only after it has been absent from the frame (for N consecutive frames / ms) and reappears
- [x] No "Item already scanned" announcement while the same code just dwells
- [x] useCamera batch-mode tests cover dwell (no increment) vs leave-and-return (increment)

## Implementation Notes

Option A: count a repeat only after the barcode has been absent for N frames/ms. Option B: lengthen the window. Files: `client/camera/hooks/useCamera.ts`, `client/screens/BatchScanScreen.tsx` and their tests.

## Updates

### 2026-11-21

- Filed from the camera audit (deferred at triage)

### 2026-11-22

- Owner decision: a repeat counts only after the barcode has left the camera view and come back — holding still never adds more.
- Done: `useCamera` batch mode refreshes a barcode's last sighting on every frame it is seen, so a repeat (`isRepeat=true`, +1 quantity, "Item already scanned") needs ≥ 2 s with the code out of view. Refreshed codes move to the back of the eviction order. Tests: dwell (counted once), leave-and-return (counts), 1999 ms gap (does not). mobile-reviewer: no blocking findings; both suggestions applied.
