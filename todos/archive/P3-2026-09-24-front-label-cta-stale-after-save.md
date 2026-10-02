---
title: 'LabelAnalysisScreen can still show "Scan Front Label" after the front label was saved'
status: done
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, client]
github_issue:
---

# Hide the "Scan Front Label" button once a front label is saved

## Summary

After PR #1036, a finished front-label scan pops back to LabelAnalysisScreen. The button can still
render there because it reads `verificationResult.canScanFrontLabel`, which is local state that a
later front-label save never clears.

## Background

`client/screens/LabelAnalysisScreen.tsx` line 651:
`{verificationResult?.canScanFrontLabel && verifyBarcode && (`. Flagged by the #1036 executor's
advisor and code-reviewer as a suggestion; left out of that PR's scope.

## Acceptance Criteria

- [ ] After a successful front-label save, returning to LabelAnalysisScreen no longer shows the
      "Scan Front Label" button
- [ ] A test covers the return-after-save case and fails without the fix

## Implementation Notes

- `verificationResult` is a plain `useState` in LabelAnalysisScreen, set in the verify
  mutation's `onSuccess` (not the mutation's `.data`, and not query-backed), and
  FrontLabelConfirmScreen's save calls no `invalidateQueries` — so there is no existing query to
  invalidate. Options: clear `canScanFrontLabel` in a focus effect after a save is signalled
  (e.g. a React Query cache entry set with `queryClient.setQueryData` on save and read on focus),
  or re-run the verification lookup on focus. Prefer the one that doesn't add navigation params.
- Files: `client/screens/LabelAnalysisScreen.tsx`,
  `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx`.

## Scope Contract

- **Mechanisms to use:** a focus effect plus ONE small save signal — a React Query cache entry
  (`setQueryData` / a new query key) is allowed for this; no new navigation params, no new
  context or store.
- **Files in scope:** the two files above (plus `client/screens/FrontLabelConfirmScreen.tsx` if the
  save must signal).
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from PR #1036's deferred warning.

### 2026-10-01

- Implemented: `FrontLabelConfirmScreen`'s confirm `onSuccess` now writes a per-barcode "saved" signal to the query cache (`["__frontLabelSaved", barcode]`, `gcTime` pinned to `Infinity` via `setQueryDefaults` per `docs/rules/hooks.md`) BEFORE `pop(2)`. `LabelAnalysisScreen` reads it in a `useFocusEffect` and clears `verificationResult.canScanFrontLabel`, so the "Scan Front Label" CTA no longer comes back after a successful save. The key helper `frontLabelSavedKey` is exported from `FrontLabelConfirmScreen.tsx` (screen-to-screen import precedent: `RecipeTextImportScreen`) and kept out of `QUERY_KEYS`, whose first elements `App.tsx` persists.
- Why a cache signal and nothing else: the server flag is per user and barcode and cannot be re-read. A second `POST /api/verification/submit` from the same user returns 409, and the only GET (`/api/verification/:barcode`) reports product-level `hasFrontLabelData`, not the per-user flag.
- Tests: `LabelAnalysisScreen.verification.test.tsx` renders both real screens under one query client. Save then refocus hides the CTA (red before the fix). Controls: a refocus with no save keeps it, a save for a different barcode keeps it, and the signal's `gcTime` is pinned. The two other `LabelAnalysisScreen` suites gained a no-op `useFocusEffect` in their `@react-navigation/native` mock (out of contract, needed for AC 1: the screen now imports it and their narrow mock factory would throw on every render).
- Reviewed clean by `code-reviewer` + `mobile-reviewer` (no findings); both ran mutation checks showing each half of the fix (writer, reader, per-barcode scoping, gc pin) is covered by a test that fails without it.
