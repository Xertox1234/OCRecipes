---
title: "Scan: allergen haptic can fire after leaving Scan, and captured photo temp files are never deleted"
status: in-progress
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, camera]
github_issue:
---

# Scan: allergen haptic can fire after leaving Scan, and captured photo temp files are never deleted

## Summary

Two minor camera-flow issues: a stray danger-allergen haptic can fire after the user has left Scan, and captured photo temp files are never cleaned up.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L1, L2** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- L1: `client/screens/ScanScreen.tsx:396-398` — `haptics.notification(Warning)` fires after the async barcode lookup with no focus/liveness check.
- L2: `capturePhotoToFile` writes to the OS temp dir (VisionCamera docs; iOS `temporaryDirectory`, Android `createTempFile`), and nothing deletes the files in Scan/LabelAnalysis/ReceiptCapture (incl. removed receipt photos). `usePhotoAnalysis.ts` already has a `useFocusEffect` cleanup to copy. ScanScreen's `nutritionImageUri`/`frontImageUri` are intentionally long-lived (shown in NutritionDetail), so clean up only when those flows end.

## Acceptance Criteria

- [ ] The haptic is gated on the screen still being focused/mounted
- [ ] Receipt photos removed by the user, and capture files from abandoned flows, are deleted with `FileSystem.deleteAsync` (idempotent)
- [ ] Tests for the gating and cleanup
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Reuse the usePhotoAnalysis cleanup pattern.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/screens/ReceiptCaptureScreen.tsx`
  - `client/screens/LabelAnalysisScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Don't delete URIs still displayed by NutritionDetail.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L1, L2).
