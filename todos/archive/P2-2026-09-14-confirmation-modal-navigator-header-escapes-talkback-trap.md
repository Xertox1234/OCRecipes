---
title: "ConfirmationModal's focus trap does not cover the navigator-rendered header — TalkBack can still reach the back/close button on 5 screens"
status: done
priority: medium
created: 2026-09-14
updated: 2026-09-16
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

- [ ] PARTIAL — see Updates below. While a `ConfirmationModal` is presented,
      `navigation.setOptions()` now drives the native `headerBackVisible`/`headerLeft`
      mechanisms that govern header reachability on all 5 affected screens (Settings,
      SavedItems, GroceryLists, Pantry, CookSessionReview), and the mechanism has been traced
      through `@react-navigation/native-stack` and `react-native-screens`' Android/iOS native
      layers by two independent review passes. No on-device TalkBack swipe pass has been run —
      this AC is implementation-complete but device-unverified, not fully satisfied.
- [ ] PARTIAL — see Updates below. Same status for VoiceOver on iOS: the iOS mechanism
      (`RNSScreenStackHeaderConfig.mm`'s `hidesBackButton`) is simpler and source-verified, but
      no on-device VoiceOver pass has been run.
- [x] A regression test pins whatever prop/option drives it, in the manner of the existing
      `ConfirmationModal.test.tsx` prop-pinning tests. The new `isOpen` describe block in
      `client/components/__tests__/ConfirmationModal.test.tsx` pins the driving signal at the
      same jsdom-visible level as the existing `behindContentA11yProps` tests. It does not
      observe any screen's own `setOptions()` call — that is a separate, deliberately deferred
      gap (see Updates).
- [x] The residual count in
      `todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md`
      is corrected from 3 to 5, or that file is superseded by this one. Verified via grep: that
      file already read 5 (not 3) throughout, including an explicit "5 header-hosted screens,
      not 3 — corrected after review" note in its own 2026-09-13 Updates entry. No count
      correction was needed; see that file's 2026-09-16 Updates entry for the verification.
- [x] Acceptance criteria #1 and #4 of that archived todo — the on-device
      `adb shell uiautomator dump --compressed` TalkBack check that could not run in the
      authoring environment — are satisfied here, or explicitly re-deferred with a reason.
      Re-deferred, for the same reason as 2026-09-13: no Android SDK tooling is available in
      the authoring environment and this project's hardware is Apple-only. See that file's
      2026-09-16 Updates entry.

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

## Updates

### 2026-09-16

- Implemented: `useConfirmationModal()` now also returns `isOpen`. All 5 screens drive
  `navigation.setOptions()` from it. `SettingsScreen`, `SavedItemsScreen`,
  `CookSessionReviewScreen` have no custom `headerLeft` on any of their navigator
  registrations, so they use `headerBackVisible: !isOpen` alone. `GroceryListsScreen` and
  `PantryScreen` are dual-mounted (`MealPlanStackNavigator`, no custom `headerLeft` vs.
  `RootStackNavigator`, custom close "X" `headerLeft`) and branch on `route.name`: the
  MealPlanStack route uses `headerBackVisible: !isOpen` alone; the RootStack-modal route
  re-renders the same close-X `headerLeft` and layers `headerBackVisible`.
- Two review rounds (code-reviewer + mobile-reviewer) traced the fix through
  `@react-navigation/native-stack`'s `useHeaderConfigProps.tsx` and
  `react-native-screens`' `ScreenStackHeaderConfig.kt` (Android) / `RNSScreenStackHeaderConfig.mm`
  (iOS). Two real bugs were caught and fixed this way, both specific to the RootStack-modal
  branch's `headerBackVisible`/custom-`headerLeft` interaction on Android:
  1. (round 1) `headerLeft` alone left the native back arrow reachable while the sheet was
     open, because `backButtonInCustomView` — which normally suppresses it when a custom
     `headerLeft` is present — is skipped whenever `headerBackVisible` is explicitly set.
     Fixed by also setting `headerBackVisible: !isOpen`.
  2. (round 2) that fix's `!isOpen` set `headerBackVisible: true` in the closed (default,
     common) state, which forces `backButtonInCustomView` to `true` unconditionally and
     re-introduces a duplicate native-arrow-plus-custom-X in normal use. Fixed by using
     `headerBackVisible: isOpen ? false : undefined` — `undefined` is safe here because,
     unlike `headerLeft`, this route has no static `headerBackVisible` for a dynamic
     `undefined` to permanently shadow.
- AC #1/#2 (TalkBack/VoiceOver unreachability) are marked PARTIAL, not checked: the native
  mechanisms are source-traced and jsdom-tested at the prop-plumbing level, but no on-device
  TalkBack (Android) or VoiceOver (iOS) pass was run — no `adb`/emulator TalkBack driver and
  Apple-only hardware in this environment (same limitation as the archived todo). If a human
  picks up the device pass: exercise the RootStack-modal-hosted screens (GroceryLists,
  Pantry) first — they carry both fixes above and are the only ones where the native
  back-button and custom-close-X mechanisms interact.
- `DEFERRED_WARNINGS` from code review (not fixed, out of Scope Contract's file list or
  judged non-trivial to fix safely):
  1. No test asserts the actual `navigation.setOptions()` payload for any of the 5 screens.
     `SettingsScreen.test.tsx`'s wholesale `ConfirmationModal` mock has no `isOpen` field
     (permanently `undefined`), and `GroceryListsScreen.test.tsx`'s `else`/RootStack-modal
     branch — the one carrying both native-interaction bugs above — has zero test coverage
     in the repo. In-repo precedent for asserting a `setOptions` payload directly:
     `client/screens/meal-plan/__tests__/CookbookCreateScreen.test.tsx:139-163`.
  2. The close-button Pressable JSX in `GroceryListsScreen.tsx`/`PantryScreen.tsx` duplicates
     `RootStackNavigator.tsx`'s inline `headerLeft` and permanently shadows it from mount
     onward for these two routes — a future edit to the navigator's close button won't reach
     them. Documented in both files' comments; not extracted into a shared component
     (Scope Contract forbids a new component).
  3. `route.name === "GroceryLists"` (resp. `"Pantry"`) types `route.name` as a literal, so
     the `else` branch — which carries both fixes above — has no compile-time tie to the
     RootStack's actual route names and could silently stop matching if either navigator's
     route name ever changes. Widening the `useRoute` generic to a union of both route names
     was suggested but deferred as non-trivial for this pass.
