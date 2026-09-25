---
title: "LabelAnalysisScreen: the error state and the verification result are never announced to screen readers"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-25
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

### 2026-09-25

- Implemented (TDD, red→green): full-screen error now renders via `InlineError`
  (announced on both platforms internally); verification-result banner announces
  once per distinct message via a NoticeStack-style ref-guarded, content-keyed
  effect, its inert `accessibilityRole="alert"` removed, and its decorative icon
  hidden (`accessible={false}` + `importantForAccessibility="no-hide-descendants"`);
  the "Updated with AI analysis" toast's announce is merged into the existing
  sessionId "Ready to log"/"Ready to submit verification" effect (both can land in
  the same React commit — iOS drops the second of two same-tick
  `announceForAccessibility` calls, see
  `docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`);
  the toast's `FadeInUp` entering animation now respects `reducedMotion`. New test
  file: `client/screens/__tests__/LabelAnalysisScreen.a11y.test.tsx` (7 tests).
- Reviewed by `code-reviewer` + `mobile-reviewer` (one pass) at `650c6d14` — no
  blocking findings. Two WARNINGs filed as follow-up todos per the one-review-pass
  policy (not fixed on this branch):
  `todos/P3-2026-09-25-label-analysis-toast-icon-not-hidden.md` (toast's
  `check-circle` icon not hidden) and
  `todos/P2-2026-09-25-label-analysis-low-confidence-error-dead-branch.md`
  (pre-existing: the `confidence < 0.3` error is set alongside `labelData`, so it
  can never render — untouched by this diff, out of scope for this todo).

### 2026-09-25 (review repair)

- The "Updated with AI analysis" toast's check icon is now hidden from screen readers (`accessible={false}` + `importantForAccessibility="no-hide-descendants"`, matching the verification banner), with a test. The P3 todo filed for it is removed. The pre-existing dead low-confidence error branch stays filed as `todos/P2-2026-09-25-label-analysis-low-confidence-error-dead-branch.md`: the visual warning already exists, so the work is removing the dead `setError` and announcing the existing confidence banner, outside this change's scope.
