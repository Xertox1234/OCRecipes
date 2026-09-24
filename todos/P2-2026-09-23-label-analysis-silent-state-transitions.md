---
title: "LabelAnalysisScreen: the error state and the verification result are never announced to screen readers"
status: backlog
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# LabelAnalysisScreen: the error state and the verification result are never announced to screen readers

## Summary

On the Label analysis screen, a failed analysis swaps the spinner for bare error text with no announcement, and the "Thanks for verifying" / "Values differ" result uses `accessibilityRole="alert"`, which announces nothing on either platform.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M9, M10** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- M9: `client/screens/LabelAnalysisScreen.tsx:181-188` (catch), :344-364 (bare `<ThemedText>{error}</ThemedText>`, no InlineError/live region/announce).
- M10: :251-256 (`verifyLog` onSuccess sets state only), :618-648 (`accessibilityRole="alert"`, decorative Feather icon :631-635 not hidden).
- Research: RN maps `alert` → `UIAccessibilityTraitNone` on iOS (`RCTViewManager.m:31`); `accessibilityLiveRegion` is Android-only, so iOS needs `AccessibilityInfo.announceForAccessibility`. Both `confirmed`. Rule: `docs/rules/accessibility.md` (async transitions need an imperative announce).
- Also on this screen (from L12): the error-state `alert-circle` icon (:348) is not hidden, and the "Updated with AI analysis" toast (:679-691) is unannounced and its `entering` animation ignores reduced motion.

## Acceptance Criteria

- [ ] The error state uses `InlineError` (or equivalent) and is announced on both platforms
- [ ] The verification result is announced once on success, and its decorative icon is hidden
- [ ] The "Updated with AI analysis" toast is announced, and its entering animation respects reduced motion
- [ ] Tests assert announceForAccessibility / live-region props for each transition
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Follow the edge-guarded announcer patterns already used by NoticeStack / NutritionDetailScreen, to avoid double-announcing.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/LabelAnalysisScreen.tsx`
  - `client/screens/__tests__/LabelAnalysisScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- LabelAnalysisScreen was just changed by #1036 (front-label verification) — rebase carefully.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M9, M10).
