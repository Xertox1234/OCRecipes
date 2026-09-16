---
title: "ConfirmationModal's focus trap does not cover the navigator-rendered header — TalkBack can still reach the back/close button on 5 screens"
status: backlog
priority: medium
created: 2026-09-14
updated: 2026-09-14
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# ConfirmationModal's focus trap does not cover the navigator-rendered header

## Summary

`behindContentA11yProps` (added by PR #963) hides a screen's **own** render tree from
TalkBack/VoiceOver while a `ConfirmationModal` sheet is presented, but it cannot reach the
header the **navigator** renders as a sibling. On 5 of the 8 caller screens a TalkBack user
can still swipe to the header back/close button and activate it, escaping the trap.

## Background

Deferred out of PR #963 deliberately. That PR carried a Scope Contract limited to
`ConfirmationModal` and its callers; adding `navigation.setOptions` plumbing would have
been a new mechanism outside that contract, which `docs/AI_WORKFLOW.md` → Tier handling
treats as a blocking (CRITICAL) violation. Closing the gap is therefore its own task.

This is **not a regression** — the escape predates #963, and #963 closes the much larger
hole (previously the entire background was reachable). But the archived todo
`todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md`
records the residual as affecting "3 header-hosted screens", and the measured count is 5.

Verified during review of #963 by reading `client/navigation/ProfileStackNavigator.tsx`
and `client/navigation/RootStackNavigator.tsx`:

- `Settings` and `SavedItems` are pushed from `ProfileScreen` with only `headerTitle` set —
  no `headerShown: false` — so `useScreenOptions()` leaves the native-stack default
  (`headerShown` true, automatic back button).
- `GroceryListsModal` and `PantryModal` (`presentation: "modal"`) carry an explicit
  `headerLeft` close button.
- `CookSessionReview` carries `headerTitle: "Review Ingredients"`.

The flagship motivating case of the original todo — Settings → Sign Out
(`client/screens/SettingsScreen.tsx:220`) — is one of the 5.

## Acceptance Criteria

- [ ] While a `ConfirmationModal` is presented, the navigator header's back/close control
      is not reachable by TalkBack swipe navigation on all 5 affected screens
      (Settings, SavedItems, GroceryLists, Pantry, CookSessionReview).
- [ ] The same holds for VoiceOver on iOS.
- [ ] A regression test pins whatever prop/option drives it, in the manner of the existing
      `ConfirmationModal.test.tsx` prop-pinning tests.
- [ ] The residual count in
      `todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md`
      is corrected from 3 to 5, or that file is superseded by this one.
- [ ] Acceptance criteria #1 and #4 of that archived todo — the on-device
      `adb shell uiautomator dump --compressed` TalkBack check that could not run in the
      authoring environment — are satisfied here, or explicitly re-deferred with a reason.

## Implementation Notes

Likely shape: drive `navigation.setOptions({ headerLeft: isOpen ? () => null : undefined })`
(or `headerBackVisible`) from `useConfirmationModal()`'s `isOpen`, so the header control
disappears from the accessibility tree while the sheet is up. Confirm that removing
`headerLeft` does not also break the hardware back gesture, which `useSheetBackHandler`
already intercepts.

**Verification constraint — read before planning the check.** This project's hardware is
Apple-only, so Android verification runs on an emulator, and `adb input` does **not** drive
TalkBack (see the `reference_talkback_emulator_verification` and
`reference_adb_input_does_not_drive_talkback` notes). The on-device criteria above will
need manual TalkBack interaction; budget for that rather than assuming a scripted check.
Also note `focusable={false}` does NOT exclude a node from the TalkBack tree — only
`importantForAccessibility="no-hide-descendants"` (Android) / `accessibilityElementsHidden`
(iOS) do.

## Scope Contract

- **Mechanisms to use:** React Navigation `setOptions` from the existing
  `useConfirmationModal()` hook — no new context, no new provider, no new component.
- **Files in scope:** `client/hooks/useConfirmationModal.ts` (or wherever `isOpen` lives),
  the 5 affected screens, `client/components/__tests__/ConfirmationModal.test.tsx`, and the
  archived todo named above.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Builds on PR #963 (`behindContentA11yProps`), which must land first.
