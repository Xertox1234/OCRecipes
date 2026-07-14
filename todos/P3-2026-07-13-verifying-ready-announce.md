<!-- Filename: P3-2026-07-13-verifying-ready-announce.md -->

---

title: "Announce Label Analysis 'Verifying' → 'Ready' button transition for screen readers"
status: backlog
priority: low
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [deferred, accessibility]
github_issue:

---

# Announce Label Analysis 'Verifying' → 'Ready' button transition for screen readers

## Summary

`LabelAnalysisScreen`'s log button silently flips from disabled "Verifying..." to actionable "Log X cal" once the background AI upload's `sessionId` arrives — a screen-reader user who focused the button while it read "Verifying..." gets no signal when it becomes actionable.

## Background

Flagged by mobile-reviewer during the PR #617 code review (fix for the silent no-op log button). The failure transition is already announced via a toast, but the success (verifying → ready) transition has no paired `AccessibilityInfo.announceForAccessibility` call. Low severity — the state is legible on-demand via the button's `busy`/label the next time the user focuses it.

## Acceptance Criteria

- [ ] `LabelAnalysisScreen.tsx` announces something like "Ready to log" (iOS-gated per the project's announce-vs-live-region convention, matching sibling patterns) when `sessionId` transitions from `null` to set, guarded so it doesn't fire on mount
- [ ] No double-announcement on platforms with an existing live region for this transition

## Implementation Notes

- See `client/screens/LabelAnalysisScreen.tsx` — the upload effect (~line 110) and `logButtonPresentation` memo
- Follow the announce-on-idle→busy-edge-with-prev-value-ref-guard pattern already documented in `docs/rules/accessibility.md`

## Dependencies

- None

## Risks

- None significant — additive, no behavior change

## Updates

### 2026-07-13

- Filed from PR #617 mobile-reviewer finding
