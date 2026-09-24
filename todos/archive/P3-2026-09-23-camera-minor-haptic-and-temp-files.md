---
title: "Scan: allergen haptic can fire after leaving Scan, and captured photo temp files are never deleted"
status: done
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

- [x] The haptic is gated on the screen still being focused/mounted
- [x] Receipt photos removed by the user, and capture files from abandoned flows, are deleted with `FileSystem.deleteAsync` (idempotent)
- [x] Tests for the gating and cleanup
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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

### 2026-09-24

- Implemented and verified (commit `21c01cec`): ScanScreen.tsx's `fetchProductInfo` now gates its danger-allergen Warning haptic on `navigation.isFocused()`; ScanScreen.tsx/ReceiptCaptureScreen.tsx/LabelAnalysisScreen.tsx now delete abandoned/removed capture temp files via `expo-file-system/legacy`'s `deleteAsync(uri, {idempotent:true})`, tracking ownership so files still needed downstream (NutritionDetail, LabelAnalysis, FrontLabelConfirm, ReceiptReview) are never deleted. TDD-verified (each new test confirmed failing on pre-fix code, passing after). Full suite green: 8647/8647 tests, clean `tsc`, clean lint (only 3 pre-existing warnings, none introduced).
- Three independent review passes (`code-reviewer` ×2, `mobile-reviewer` ×1) found **no CRITICAL findings** — the ownership-transfer logic was traced and confirmed correct against the reducer and every receiving screen. Per the one-review-pass policy, all WARNING/SUGGESTION findings are recorded verbatim in the closing PR's `DEFERRED_WARNINGS` rather than fixed on this branch — see the PR description for the full list (test-discrimination gaps in 3 new tests, silent `.catch(() => {})` error-swallowing on all 4 `deleteAsync` sites, two untracked capture paths — the `onSmartPhotoConfirm` grocery_receipt/has_barcode routes and the direct front-label capture branch — that still leak their temp file, and a `setPhotos`-updater purity nit).
- Out-of-scope findings surfaced by reviewers (not fixed here — outside this todo's Scope Contract): `client/hooks/usePhotoAnalysis.ts` imports `deleteAsync` from the root `expo-file-system` package, which throws unconditionally in the installed v19 and is silently swallowed — its existing cleanup has never deleted a file. `FrontLabelConfirmScreen.tsx` and `ReceiptReviewScreen.tsx` never delete the capture files handed to them.
