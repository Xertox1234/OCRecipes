---
title: "LabelAnalysisScreen: the low-confidence (<0.3) upload error is set but never rendered or announced"
status: backlog
priority: medium
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, bug, accessibility]
github_issue:
---

# LabelAnalysisScreen: the low-confidence (<0.3) upload error is set but never rendered or announced

## Summary

In the upload effect's success path, when the AI analysis returns `confidence < 0.3` with no local preview data, `setLabelData(result.labelData)` and `setError(...)` are both called in the same synchronous continuation. Because the screen's only error-rendering branch is `if (error && !labelData)`, and `labelData` is already set by the time `error` is set, this error is never rendered to sighted users and never reaches the (newly added) `InlineError`/announcer path — it is dead on arrival.

## Background

Surfaced by the `mobile-reviewer` during the review pass for `todos/archive/P2-2026-09-23-label-analysis-silent-state-transitions.md` (WARNING, pre-existing/untouched by that diff, non-blocking, one-review-pass policy). Reviewer quote: "This instance of the error state is dead: never shown to sighted users, never announced, both before and after this fix."

As of the review, the relevant code in `client/screens/LabelAnalysisScreen.tsx`:

```tsx
} else {
  // No local preview or low confidence — use AI data directly
  setLabelData(result.labelData);
  setDataSource("ai");

  if (result.labelData.confidence < 0.3) {
    setError(
      "Could not read the label clearly. Try again with better lighting.",
    );
  }
}
```

and the only consumer of `error`:

```tsx
if (error && !labelData) {
  // ... renders <InlineError message={error} />
}
```

Since `labelData` is truthy by the time `error` is set, this branch can never trigger from this code path. Users who get a very-low-confidence AI read currently see and hear nothing indicating the read may be inaccurate.

## Acceptance Criteria

- [ ] A low-confidence (`< 0.3`) AI analysis result, when it lands in the same commit as `setLabelData`, surfaces a warning to the user — visually and via a screen-reader announcement — without duplicating an announcement in the same React commit as the existing "Ready to log"/"Updated with AI analysis" merged announcer (`client/screens/LabelAnalysisScreen.tsx`; see `docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`).
- [ ] The fix does not reintroduce the `error && !labelData` dead branch for this case — either render the low-confidence warning through a separate, always-visible surface (e.g. a `NoticeStack`-style banner) rather than the full-screen `error` state, or explicitly allow this one case through the full-screen guard with a clear rationale.
- [ ] A failing test is written first (TDD) reproducing a low-confidence AI response and asserting the warning is visible and announced; then the fix; then it passes.

## Implementation Notes

- Route any new announcement through the existing merged announcer effect (the one that already combines the sessionId "Ready to log"/"Ready to submit verification" and "Updated with AI analysis" cases) rather than adding a third independent `AccessibilityInfo.announceForAccessibility` call — the two can land in the same commit as `sessionArrived`, and iOS drops the second of two same-tick announces.
- Consider whether the intended fix is "show a NoticeStack-style low-confidence warning banner" rather than reusing the full-screen `error` state, since `labelData` is legitimately present and the AI data is still shown to the user.

## Scope Contract

- **Mechanisms to use:** the existing merged announcer effect and/or the existing `NoticeStack`-style banner pattern already used elsewhere in this codebase — no new announcement mechanism.
- **Files in scope:**
  - `client/screens/LabelAnalysisScreen.tsx`
  - `client/screens/__tests__/LabelAnalysisScreen*.test.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Must avoid recreating the same-commit iOS double-announce collision this fix's sibling todo (P2-2026-09-23-label-analysis-silent-state-transitions, archived) just closed — route through the merged announcer, not a fourth independent effect.

## Updates

### 2026-09-25

- Filed from the mobile-reviewer's WARNING finding during the P2-2026-09-23-label-analysis-silent-state-transitions review pass.
