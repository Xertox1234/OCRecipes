---
title: "6 of 8 BottomSheetModal sites have no background focus trap, and the per-site on-device a11y pass was never run"
status: backlog
priority: low
created: 2026-09-14
updated: 2026-09-14
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# BottomSheetModal background trap gap + the deferred on-device pass

## Summary

Two loose ends from the `accessible={false}` sweep (PR #959), both acknowledged
in code comments there but previously untracked:

1. After that PR, only **2 of its 8** sheet sites isolate the content _behind_
   the sheet from the screen reader. The other 6 have no background trap.
2. Acceptance criterion #2 of
   `todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md`
   — per-site Maestro `inspect_screen` verification on a booted sim — was not
   performed for any of the 8 sites.

They are filed together because both are settled in one device session.

## Background

PR #959 fixed a _different_ defect: the sheet's own content collapsing into a
single iOS accessibility leaf. Background isolation was correctly out of its
scope. But `client/screens/meal-plan/MealPlanHomeScreen.tsx` carries a comment
saying "These 4 sheets have NO tracked focus-trap follow-up", and per
`CLAUDE.md` → Deferred Item Todos an acknowledged Low-severity gap is the tier
that auto-files rather than living in a comment. This file is that artifact.

Which sites have a working trap today, per review of #959:

- **Has one:** `client/components/BeveragePickerSheet.tsx` (inner
  `<View accessibilityViewIsModal>`), `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  (inner `<BottomSheetView accessibilityViewIsModal>`).
- **Has none:** `client/screens/HomeScreen.tsx`, all 4 sheets in
  `client/screens/meal-plan/MealPlanHomeScreen.tsx`, and
  `client/screens/meal-plan/RecipeEntryHubScreen.tsx`.

The fix shape is already proven in this codebase — one line per site, on the
sheet's own inner content `View` / `BottomSheetView`.

**Why it must go on the inner view and not the wrapper.** `accessibilityViewIsModal`
placed on `<BottomSheetModal>` reaches no native view: `BottomSheetModal` spreads
`...bottomSheetProps` onto `<BottomSheet>` (`BottomSheetModal.tsx:61,547`), and
`BottomSheet` has no rest-spread at all, forwarding only `accessible`,
`accessibilityRole` and `accessibilityLabel` (`BottomSheet.tsx:1829-1831`).
`BottomSheetView` _does_ spread `...rest` onto a real `<View>`
(`BottomSheetView.tsx:18,84`), which is why it works there. Dead
`accessibilityViewIsModal` props on the wrapper were removed in #959 for exactly
this reason — do not reintroduce them.

## Acceptance Criteria

- [ ] Each of the 6 sites above isolates its behind-content from VoiceOver /
      TalkBack while its sheet is presented, using the inner-view placement
      described above.
- [ ] A regression test pins the prop at each newly-trapped site, in the manner
      of the existing `accessible={false}` prop-pinning tests.
- [ ] Per-site `inspect_screen` verification on a booted simulator for all 8
      sheet sites confirms the sheet's own children are reachable as individual
      descendants — closing AC #2 of the archived todo named above.
- [ ] That archived todo is updated to record the result.

## Implementation Notes

jsdom render tests cannot observe the native leaf-collapse or the modal trap in
either direction; they can only pin that the prop was passed. Say so in test
names rather than implying native verification, matching the convention the
existing tests already follow.

For the device pass, the dev loop supports Maestro `inspect_screen` against a
booted sim. Note the project's hardware is Apple-only, so the iOS pass is the
one that can be automated here; an Android TalkBack equivalent needs an emulator
and `adb input` does not drive TalkBack.

## Scope Contract

- **Mechanisms to use:** `accessibilityViewIsModal` on each sheet's existing
  inner content view — no new component, no wrapper, no context.
- **Files in scope:** the 6 screens listed above, their co-located tests, and
  `todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Builds on PR #959, which must land first.
