---
title: "LabelAnalysisScreen: 'Updated with AI analysis' toast icon is not hidden from screen readers"
status: backlog
priority: low
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, accessibility]
github_issue:
---

# LabelAnalysisScreen: 'Updated with AI analysis' toast icon is not hidden from screen readers

## Summary

The decorative `check-circle` Feather icon inside the "Updated with AI analysis" toast (`client/screens/LabelAnalysisScreen.tsx`, the `showUpdatedToast` `Animated.View` block) is not marked `accessible={false}`, unlike the sibling decorative icons the same file already hardens elsewhere (InlineError's icon, the verification-result banner's icon).

## Background

Surfaced by the `mobile-reviewer` during the review pass for `todos/archive/P2-2026-09-23-label-analysis-silent-state-transitions.md` (WARNING, non-blocking, one-review-pass policy — not fixed on that branch per `docs/AI_WORKFLOW.md` → Review Policy).

That todo added an imperative `AccessibilityInfo.announceForAccessibility` call that now actively speaks this toast's content ("Updated with AI analysis", merged with the "Ready to log" announce). Reviewer quote: "Now that this toast is actively spoken via the new merged announcer ... a TalkBack/VoiceOver user who swipes onto the toast node after it appears gets the raw glyph as a separate, unlabeled focus stop beside the text."

## Acceptance Criteria

- [ ] The `check-circle` Feather icon inside the `showUpdatedToast` `Animated.View` in `client/screens/LabelAnalysisScreen.tsx` has `accessible={false}`, matching the pattern already applied to the verification-result banner's icon and `InlineError`'s icon in the same file.
- [ ] Existing tests still pass; no new test is strictly required (the `accessible` prop is not observable via this project's jsdom mocks — see `docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`), but adding one is fine if convenient.

## Implementation Notes

Single-line fix: add `accessible={false}` to the `<Feather name="check-circle" ... />` element inside the toast block (as of the review, `client/screens/LabelAnalysisScreen.tsx` around the `showUpdatedToast &&` block).

## Scope Contract

- **Mechanisms to use:** the existing `accessible={false}` convention already used elsewhere in this same file — nothing new.
- **Files in scope:**
  - `client/screens/LabelAnalysisScreen.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None — purely additive accessibility prop, no behavior change.

## Updates

### 2026-09-25

- Filed from the mobile-reviewer's WARNING finding during the P2-2026-09-23-label-analysis-silent-state-transitions review pass.
