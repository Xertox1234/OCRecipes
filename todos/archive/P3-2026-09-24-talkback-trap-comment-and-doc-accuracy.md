---
title: "Three accuracy slips left by PR #1038: a RecipeBrowserScreen comment names the wrong iOS trap, and the archived todo has a wrong import claim and an off-by-one"
status: done
priority: low
created: 2026-09-24
updated: 2026-10-01
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

- [x] The RecipeBrowserScreen comment points at the filter sheet's `BottomSheetView` trap
- [x] The archived todo's import clause and test count are corrected with a dated Updates note
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

### 2026-10-01

- Fixed all three slips. `RecipeBrowserScreen.tsx`'s `isFilterSheetOpen` comment now attributes the
  iOS trap to the filter sheet's own `BottomSheetView` `accessibilityViewIsModal`, in the same
  "sheet's own content root" wording the `HomeScreen`, `RecipeEntryHubScreen` and
  `MealPlanHomeScreen` comments already use, instead of the screen's root View (the later comment
  beside the root View's `importantForAccessibility` was left as is). In the archived Android
  TalkBack trap todo, the site-8 import clause and the test count are corrected in place, and a
  dated 2026-10-01 Updates entry there quotes the old wording.
- Each claim was checked against the tree before editing, since a todo's claim is still only a
  claim: `PhotoAnalysisScreen.tsx` imports `usePhotoAnalysis` directly (and it is
  `usePhotoAnalysis.ts` that calls `useBeverageSheet`); `HomeScreen.test.tsx` had exactly 9 tests at
  the #1038 merge (`850a4016`), so "the other 8". That count is anchored to the merge because the
  file has since grown (30 as of this entry).
- A sweep by target (not by wording) for other copies of either wrong claim found none.
