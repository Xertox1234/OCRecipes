---
title: "Temp-file cleanup follow-ups: two capture paths still leak, non-discriminating tests, and usePhotoAnalysis's cleanup never runs"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, camera]
github_issue:
---

# Temp-file cleanup follow-ups: two capture paths still leak, non-discriminating tests, and usePhotoAnalysis's cleanup never runs

## Summary

PR #1055 (merged) fixed most of the ScanScreen/ReceiptCaptureScreen/LabelAnalysisScreen temp-capture-file leaks, but its own reviewers deferred five findings as WARNING/SUGGESTION under the one-review-pass policy, and the orchestrator separately verified that `usePhotoAnalysis.ts`'s existing cleanup has never actually run. This todo closes those out.

## Background

Deferred `DEFERRED_WARNINGS` from PR #1055's body (`gh pr view 1055`), each re-verified against the current code at HEAD (`cb44067b`):

1. **`ScanScreen.tsx` `onSmartPhotoConfirm`'s `"navigate"` case leaks two outcomes.** At `client/screens/ScanScreen.tsx:966` `releaseTempUri(imageUri)` runs unconditionally before the inner `switch (action.route.screen)`, but `ClassificationRoute` (`client/screens/scan-screen-utils.ts:17-28`) declares `{ screen: "ReceiptCapture"; params: undefined }` and `{ screen: "NutritionDetail"; params: { barcode } }` — neither destination param object carries `imageUri`. The `ReceiptCapture` navigate call (`ScanScreen.tsx:989`, `navigation.navigate("ReceiptCapture")`, no params) and the `NutritionDetail` call (`ScanScreen.tsx:991-992`, params is just `{ barcode }`) both receive no URI, so `releaseTempUri` removes the file from `pendingTempUrisRef` (meaning the abandon-cleanup path in `resetScan()` will never delete it either) and nothing else ever deletes it — the file leaks permanently for the `grocery_receipt`/`restaurant_receipt`/`has_barcode` smart-classification outcomes. Fix: only call `releaseTempUri(imageUri)` when the destination route's params actually carry the URI (mirror the discipline already used at `onEditStep3`, `ScanScreen.tsx:928-940`); otherwise call `deleteAsync(imageUri, { idempotent: true })` directly before navigating.

2. **Front-label capture branch never tracks or cleans up its temp file.** `client/screens/ScanScreen.tsx:573-591` (`onShutterPress`, the `isFrontLabelMode && verifyBarcode` branch) captures `photo.uri` and calls `navigation.navigate("FrontLabelConfirm", { imageUri: photo.uri, ... })` without ever calling `trackTempUri(photo.uri)` — unlike the smart/label/step branches later in the same function, which all call `trackTempUri` (`ScanScreen.tsx:623`, `:655`). `client/screens/FrontLabelConfirmScreen.tsx` reads `imageUri` from `route.params` (line 88), displays it (line 207), and uploads it once via `uploadFrontLabelPhoto(imageUri, barcode)` in a mount-only effect (lines 105-144) — but no effect anywhere in the file ever calls `deleteAsync` on it. Both exits — `handleConfirm`'s success path (`navigation.pop(2)`, line 157) and `handleRetake` (`navigation.goBack()`, line 186) — unmount the screen and leak the file. Verified nothing downstream needs it after unmount: `NutritionDetailScreen`'s "Add product details" CTA (`client/screens/NutritionDetailScreen.tsx:580-585`, `navigation.navigate("Scan", { mode: "front-label", verifyBarcode: barcode })`) and `LabelAnalysisScreen`'s equivalent CTA (`LabelAnalysisScreen.tsx:684`) never receive or store this temp URI — verification state is refreshed server-side, not from the local file. Fix: track the URI in `onShutterPress`'s front-label branch, and add an unmount-only cleanup effect in `FrontLabelConfirmScreen.tsx` (the same shape as `LabelAnalysisScreen.tsx`'s deliberately-unmount-only cleanup, not focus-based — see `docs/solutions/conventions/navigate-vs-replace-modal-flows-2026-05-13.md` and the `#1044` `goBack` rationale comment at `FrontLabelConfirmScreen.tsx:180-186` for why this screen's stack position differs from a `replace`-based flow) that deletes `imageUri` once nothing downstream needs it (both the confirm-success `pop(2)` and the retake `goBack()` unmount it, so a single unmount effect covers both exits — no focus-based special case is needed here, unlike `LabelAnalysisScreen`'s own front-label-CTA caveat).

3. **Two tests are structurally non-discriminating** (verified: both pass even with their guarded code deleted):
   - `client/screens/__tests__/ScanScreen.test.tsx:1316` (`"does not delete the nutrition photo forwarded to NutritionDetail"`) — the mocked `SESSION_COMPLETE` shortcut never populates `pendingTempUrisRef` via a real capture and `isFocused` never flips false, so the assertion `expect(mockDeleteAsync).not.toHaveBeenCalledWith(...)` is vacuously true regardless of whether the guard exists.
   - `client/screens/__tests__/ReceiptCaptureScreen.test.tsx:102` (`"does not delete photos handed off to ReceiptReview via Done"`) — the mocked `navigation.replace` never unmounts the component, so the cleanup effect never runs either way; `expect(mockDeleteAsync).not.toHaveBeenCalled()` passes trivially.

   Rewrite each so it fails when the guard it's meant to protect is removed — prove this with a mutation check (temporarily comment out or delete the guard, run the test, confirm RED, then `git checkout -- <file>` to restore).

4. **Zero coverage on 3 of 5 `releaseTempUri` call sites** in `ScanScreen.tsx`: `onEditStep2` (`:912-927`), `onEditStep3` (`:928-941`), and `onSmartPhotoConfirm`'s navigate case (`:962-1008`, the same call site item 1 fixes). Add tests asserting `deleteAsync` is/isn't called as appropriate for each.

5. **SUGGESTION**: `client/screens/ReceiptCaptureScreen.tsx`'s `handleRemovePhoto` runs its `deleteAsync` side effect inside the `setPhotos` state-updater callback. Move the side effect outside the updater (compute the removed photo, call `deleteAsync` on it, then call `setPhotos`) — more idiomatic; `idempotent: true` makes today's double-invoke risk harmless, so this is a style fix, not a correctness one.

Orchestrator-verified defect (not from PR #1055's own review, found independently while scoping this todo): `client/hooks/usePhotoAnalysis.ts:6` imports `* as FileSystem from "expo-file-system"` and calls `FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(() => {})` at line 112, inside a `useFocusEffect` cleanup (lines 101-118). In the installed `expo-file-system@19.0.22`, the package root's `deleteAsync` is a deliberate throwing stub (`node_modules/expo-file-system/src/legacyWarnings.ts:62-64`, re-exported by `src/index.ts:14`) — every invocation of this cleanup has thrown and been silently swallowed since SDK 54 landed, so this screen's own "cleanup" has never freed a file. `client/hooks/__tests__/usePhotoAnalysis.test.ts` mocks `useFocusEffect` as a no-op (`() => {}`, line 20), so CI never actually runs the cleanup closure in either direction — the bug has zero test coverage. This is documented in `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md`, which explicitly lists `usePhotoAnalysis.ts` under "Related Files" as "the still-open instance of this bug ... not yet fixed" — this todo is what closes it.

## Acceptance Criteria

- [ ] `ScanScreen.tsx`'s `onSmartPhotoConfirm` `"navigate"` case only releases (without deleting) the tracked URI when the destination route's params actually carry `imageUri`; for the `ReceiptCapture` and `NutritionDetail` outcomes (which don't), the file is explicitly deleted instead of merely released, so it no longer leaks for any `ClassificationRoute` outcome.
- [ ] `ScanScreen.tsx`'s front-label capture branch (`isFrontLabelMode && verifyBarcode` in `onShutterPress`) calls `trackTempUri(photo.uri)` before navigating to `FrontLabelConfirm`.
- [ ] `FrontLabelConfirmScreen.tsx` deletes `imageUri` via `expo-file-system/legacy`'s `deleteAsync(uri, { idempotent: true })` once nothing downstream needs it (covering both the confirm-success and retake exits), without deleting it while the AI-extraction upload is still in flight or before the user can view/retake the photo.
- [ ] `ScanScreen.test.tsx`'s "does not delete the nutrition photo forwarded to NutritionDetail" test is rewritten to actually fail when the guard it protects is removed (verified via a mutation check).
- [ ] `ReceiptCaptureScreen.test.tsx`'s "does not delete photos handed off to ReceiptReview via Done" test is rewritten to actually fail when the guard it protects is removed (verified via a mutation check).
- [ ] New tests cover the three previously-uncovered `releaseTempUri` call sites in `ScanScreen.tsx` (`onEditStep2`, `onEditStep3`, `onSmartPhotoConfirm`'s navigate case).
- [ ] `ReceiptCaptureScreen.tsx`'s `handleRemovePhoto` computes the removed photo and calls `deleteAsync` outside the `setPhotos` updater, not inside it.
- [ ] `usePhotoAnalysis.ts` imports `deleteAsync` from `"expo-file-system/legacy"` instead of the root `expo-file-system` package.
- [ ] A new or updated test for `usePhotoAnalysis.ts` actually invokes the real focus-effect cleanup (not a no-op mock of `useFocusEffect`) and asserts the legacy `deleteAsync` is called with the expected URI.
- [ ] `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md` is updated so its "Related Files" section no longer describes `usePhotoAnalysis.ts` as "the still-open instance of this bug ... not yet fixed" (either remove that line or mark it fixed, per the file's own conventions).
- [ ] TDD: every behavioral fix above has a test that was confirmed failing (red) against the pre-fix code before the fix landed.
- [ ] Full suite green (`test:run`, `check:types`, `lint`) with no new warnings.

## Implementation Notes

- All temp-file deletion in this codebase uses `expo-file-system/legacy`'s `deleteAsync(uri, { idempotent: true })` — see `client/screens/ScanScreen.tsx:23`, `ReceiptCaptureScreen.tsx:18`, `LabelAnalysisScreen.tsx:22` for the established import pattern; `usePhotoAnalysis.ts` is the one remaining holdout on the root-package stub.
- `ScanScreen.tsx`'s `pendingTempUrisRef`/`trackTempUri`/`releaseTempUri` mechanism (lines 182-193) is the existing ownership-tracking pattern — item 1 and item 2 both extend it rather than introducing a new mechanism. `releaseTempUri` removes a URI from tracking without deleting it (used when ownership transfers to a screen that will delete it itself); when nothing downstream will ever delete it, delete it directly instead of releasing it untracked.
- For item 1, the cleanest fix mirrors `onEditStep3`'s existing discipline (`ScanScreen.tsx:933`, which releases only `scanPhaseRef.current.frontImageUri` — a URI it knows transfers — not the full state, leaving `nutritionImageUri` pending for abandon-cleanup): branch on `action.route.screen` (or check whether `imageUri` appears in `action.route.params`) before deciding whether to `releaseTempUri` (ownership transferred) or `deleteAsync` directly (destination never receives the file).
- For item 2, `FrontLabelConfirmScreen.tsx` has no existing cleanup effect to extend — add one. Reference `LabelAnalysisScreen.tsx`'s unmount-only `useEffect(() => () => deleteAsync(imageUri, ...), [imageUri])` shape (deliberately unmount-only, not focus-based, per its own comment) as the closest precedent; verify (per the Background section's trace) that `FrontLabelConfirmScreen` has no mounted-but-blurred scenario that would make unmount-only wrong here — its stack position and both exits (`pop(2)` on confirm, `goBack()` on retake) both unmount it, unlike `LabelAnalysisScreen`'s front-label-CTA case.
- For the mutation-check tests (item 3), do not just add a positive assertion — trace through what a real capture-then-navigate flow would need (a real `pendingTempUrisRef` populated via `trackTempUri`, and `isFocused`/`navigation.replace` mocks that actually change screen-mounted state) so the assertion is coupled to the guard, not to a mock that never exercises it.
- For `usePhotoAnalysis.ts`'s test, replace the no-op `useFocusEffect` mock (or add a second test alongside it) with one that captures and invokes the effect's cleanup function directly, or uses a `useFocusEffect` mock that actually calls the passed callback and its returned cleanup — then assert `deleteAsync` (imported from the `expo-file-system/legacy` mock) was called with the hook's `imageUri`.
- Reuse the `verified_solutions` lookup for `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md` — it already documents the root cause, the fix pattern, and the exact "Related Files" line to update.

## Scope Contract

- **Mechanisms to use:** the existing `pendingTempUrisRef`/`trackTempUri`/`releaseTempUri` ownership-tracking pattern in `ScanScreen.tsx`; the existing unmount-only `deleteAsync` cleanup pattern from `LabelAnalysisScreen.tsx`; `expo-file-system/legacy`'s `deleteAsync(uri, { idempotent: true })`. No new abstractions, no new files beyond test files and the one solution-doc edit.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/screens/FrontLabelConfirmScreen.tsx`
  - `client/screens/ReceiptCaptureScreen.tsx`
  - `client/hooks/usePhotoAnalysis.ts`
  - `client/screens/__tests__/ScanScreen.test.tsx`
  - `client/screens/__tests__/FrontLabelConfirmScreen.test.tsx` (already exists — add cleanup-effect coverage)
  - `client/screens/__tests__/ReceiptCaptureScreen.test.tsx`
  - `client/hooks/__tests__/usePhotoAnalysis.test.ts`
  - `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md`
- Explicitly out of scope: adding logging to the swallowed `deleteAsync(...).catch(() => {})` rejections across all four sites (a separate WARNING from PR #1055, deferred here too — see Updates below); `FrontLabelConfirmScreen.tsx`/`ReceiptReviewScreen.tsx`'s other out-of-scope findings noted in PR #1055 that this todo does not name in its Acceptance Criteria; `ScanScreen.tsx`'s `returnAfterLog` allergen-haptic liveness gap (a different, pre-existing finding, not a temp-file issue).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (PR #1055 is already merged on `main`).

## Risks

- `FrontLabelConfirmScreen.tsx`'s upload effect (`uploadFrontLabelPhoto(imageUri, barcode)`) reads the file's bytes asynchronously on mount; an unmount-only cleanup is safe regardless of upload timing since the upload always starts before either exit path can unmount the screen — but confirm this ordering holds when writing the effect (no deleting the file while the upload is still reading it, though in practice `deleteAsync` and the upload race only matters if unmount happens mid-upload, which neither exit path does).
- `onSmartPhotoConfirm`'s navigate case fix touches a discriminated-union switch already flagged by `docs/rules/typescript.md` as never-cast territory (see the exhaustiveness guard at `ScanScreen.tsx:994-998`) — keep the new per-route branching exhaustive rather than adding a catch-all `default`.
- The two rewritten tests must be proven to fail pre-fix (mutation check) — a test that merely "looks stricter" but still passes without the guard does not satisfy Acceptance Criteria items 4/5.

## Updates

### 2026-09-24

- Initial creation from PR #1055's `DEFERRED_WARNINGS` (WARNING items 1-4 + SUGGESTION item 5) plus an orchestrator-verified `usePhotoAnalysis.ts` defect found while scoping this todo. Considered and deferred (not in this todo's scope): adding logging to the four silent `deleteAsync(...).catch(() => {})` sites across `ScanScreen.tsx`/`ReceiptCaptureScreen.tsx`/`LabelAnalysisScreen.tsx` — PR #1055 flagged this as its own WARNING; it's a cross-cutting logging change independent of the leak/test fixes here and left for a separate pass.
