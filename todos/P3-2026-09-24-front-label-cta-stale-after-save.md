---
title: 'LabelAnalysisScreen can still show "Scan Front Label" after the front label was saved'
status: backlog
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

- Options: refetch verification status on focus, or clear `canScanFrontLabel` when
  FrontLabelConfirmScreen reports a save. Prefer the one that doesn't add new navigation params.
- Files: `client/screens/LabelAnalysisScreen.tsx`,
  `client/screens/__tests__/LabelAnalysisScreen.verification.test.tsx`.

## Scope Contract

- **Mechanisms to use:** existing query invalidation or focus effects; no new params.
- **Files in scope:** the two files above (plus `client/screens/FrontLabelConfirmScreen.tsx` if the
  save must signal).
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from PR #1036's deferred warning.
