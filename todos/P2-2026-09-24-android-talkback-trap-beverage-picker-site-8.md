---
title: "Android TalkBack can still reach PhotoAnalysisScreen content behind the beverage picker sheet (the 8th BottomSheetModal site #1038 deferred)"
status: backlog
priority: medium
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, mobile, accessibility]
github_issue:
---

# Android TalkBack background trap for the beverage picker sheet (site 8 of 8)

## Summary

PR #1038 added the Android background trap (`importantForAccessibility="no-hide-descendants"` on
behind-sheet content while a sheet is open) to 7 of the 8 BottomSheetModal sites. The 8th, the
beverage picker, was deferred because its behind-sheet content lives outside that todo's scope.

## Background

`client/components/BeveragePickerSheet.tsx` is rendered through `usePhotoAnalysis()` →
`useBeverageSheet()` and mounted by `client/screens/PhotoAnalysisScreen.tsx` (it imports
`usePhotoAnalysis` at line 35 and renders `BeverageSheet` from its return value). The content that
must be hidden while the sheet is open is PhotoAnalysisScreen's, so the fix needs an open-state
signal from the hook plus the prop on the screen. iOS is already trapped via
`accessibilityViewIsModal` on the sheet content (PR #1000). See the archived todo
`todos/archive/P2-2026-09-20-android-talkback-background-trap-missing-on-bottomsheetmodal-sites.md`
(AC #1, site-8 deferral paragraph).

## Acceptance Criteria

- [ ] While the beverage picker sheet is open, every sibling visible behind it on
      PhotoAnalysisScreen carries `importantForAccessibility="no-hide-descendants"`; it returns to
      `"auto"` on every dismissal path (swipe, backdrop, hardware back, programmatic dismiss)
- [ ] The hook exposes an open-state boolean set on present and cleared in `onDismiss` (post
      close-animation), following the three imperative sites in #1038
- [ ] A render test pins open and closed states and fails if the prop is removed (mutation-check it)
- [ ] Walk PhotoAnalysisScreen's whole `return` tree for siblings of the trapped container
      (`docs/solutions/logic-errors/background-trap-on-scrollview-misses-sibling-with-independent-visibility-2026-09-23.md`)

## Implementation Notes

- Files: `client/hooks/useBeverageSheet.ts`, `client/hooks/usePhotoAnalysis.ts`,
  `client/screens/PhotoAnalysisScreen.tsx`, and their tests.
- Pattern to copy: `client/screens/meal-plan/RecipeEntryHubScreen.tsx` (`isImportSheetOpen` +
  `onDismiss`).
- On-device TalkBack verification needs real Android hardware (not available here) — record it as
  unverified rather than claim it.

## Scope Contract

- **Mechanisms to use:** the same `importantForAccessibility` + open-state boolean pattern #1038
  used; nothing new.
- **Files in scope:** the three files above and their co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (PR #1038 merged, `850a4016`).

## Updates

### 2026-09-24

- Filed from PR #1038's deferred site 8.
