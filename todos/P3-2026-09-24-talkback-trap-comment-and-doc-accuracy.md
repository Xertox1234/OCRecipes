---
title: "Three accuracy slips left by PR #1038: a RecipeBrowserScreen comment names the wrong iOS trap, and the archived todo has a wrong import claim and an off-by-one"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, accessibility, docs]
github_issue:
---

# Fix three comment/doc accuracy slips from PR #1038

## Summary

The final review of #1038 (no blocking findings) flagged three wording errors that could mislead a
later editor. None affects runtime behaviour.

## Background

(Line numbers drift; grep the quoted text.)

1. `client/screens/meal-plan/RecipeBrowserScreen.tsx`, the comment on `isFilterSheetOpen`: says
   iOS is trapped "via accessibilityViewIsModal on the screen's own root View below" — the
   `recipe-browser-root` View's prop. The filter sheet's own iOS trap is
   `<BottomSheetView accessibilityViewIsModal>` inside the filter sheet; the root-View prop is
   unrelated, as the later comment beside the root View's `importantForAccessibility` already
   says.
2. `todos/archive/P2-2026-09-20-android-talkback-background-trap-missing-on-bottomsheetmodal-sites.md`,
   the site-8 deferral paragraph ("neither of which this screen imports"): PhotoAnalysisScreen
   does import `usePhotoAnalysis`; only `useBeverageSheet` is indirect.
3. Same archived todo, the 2026-09-24 entry: "8 of the other 9 tests" — the file has 9 tests
   total, so 8 others.

## Acceptance Criteria

- [ ] The RecipeBrowserScreen comment points at the filter sheet's `BottomSheetView` trap
- [ ] The archived todo's import clause and test count are corrected with a dated Updates note
      (don't silently rewrite history)

## Implementation Notes

- Files: `client/screens/meal-plan/RecipeBrowserScreen.tsx`, the archived todo above. Comment-only
  change in the screen.

## Scope Contract

- **Mechanisms to use:** text edits only.
- **Files in scope:** the two files above.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-09-24

- Filed from PR #1038's final-head review.
