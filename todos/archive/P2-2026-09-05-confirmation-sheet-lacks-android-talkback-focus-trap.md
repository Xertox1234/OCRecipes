---
title: "ConfirmationModal sheet lacks an Android TalkBack focus trap — background content stays swipeable behind it"
status: done
priority: medium
created: 2026-09-05
updated: 2026-09-13
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# ConfirmationModal sheet lacks an Android TalkBack focus trap

## Summary

`ConfirmationModal` (`@gorhom/bottom-sheet` portal overlay) has **no working
focus trap on either platform**, so a screen reader can move past the presented
sheet into the host screen's content behind it. All 8 `useConfirmationModal()`
callers share the gap; PR #924 made it newly relevant for a destructive flow
(sign-out) that previously used a natively-isolated `Alert.alert`.

**Correction (2026-09-05, PR #924):** an earlier draft of this todo said the
sheet "sets only `accessibilityViewIsModal` (iOS-only)", implying iOS was
covered. That is FALSE — verified against `@gorhom/bottom-sheet` source: its
`BottomSheet` has no rest-spread, so `accessibilityViewIsModal` passed to
`BottomSheetModal` was **silently dropped and never worked on iOS either**. PR
#924 removed that dead prop. So neither platform has ever had a trap; do NOT
assume iOS is done. (Distinct from the leaf-collapse defect #924 fixed with
`accessible={false}` — that was the sheet's OWN content being unreachable; this
todo is about the content BEHIND the sheet.)

## Background

Found by the mobile-reviewer pass on PR #924 (issue #908). The codebase's own
convention doc — `docs/solutions/conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md`
— says a JS/portal overlay needs `importantForAccessibility="no-hide-descendants"`
applied to the sibling content behind it while presented; the native
`AlertDialog`/`UIAlertController` got this isolation from the OS for free.
Structural blocker: `useConfirmationModal()` exposes no open-state to callers,
so a host screen cannot tag its own content as hidden-while-presented without a
hook API change. This is why it was filed rather than fixed inside PR #924 —
the fix touches the shared hook's API and all 8 call sites.

## Acceptance Criteria

- [ ] While the sheet is presented on Android, TalkBack swipe navigation cannot
      reach the host screen's content behind it; when dismissed, the content is
      reachable again.
      PARTIAL, and left unchecked for that reason. The host screen's own render
      tree is covered. The navigator-rendered header is NOT — on 5 of the 8
      screens its back/close control stays reachable, so this criterion is not
      met end to end. `behindContentA11yProps` structurally cannot reach a
      sibling the navigator renders. Tracked by
      `todos/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md`.
- [x] The mechanism covers all 8 existing `useConfirmationModal()` callers
      (CookSessionCapture, CookSessionReview, SavedItems, ChatList, BatchScan,
      GroceryLists, Pantry, Settings) without per-screen bespoke wiring where
      avoidable.
- [x] iOS gets a REAL focus trap too (it never had one — the old `accessibilityViewIsModal` was dead code, removed in #924). Do not treat iOS as already covered.
- [ ] Verified per the house method: `adb shell uiautomator dump --compressed`
      diff with the sheet open vs closed (see
      docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md);
      `focusable=false` is NOT evidence of exclusion.
      NOT PERFORMED — no Android SDK tooling in the authoring environment
      (`adb` and the emulator both exited 127). This project's hardware is
      Apple-only, and `adb input` does not drive TalkBack, so this criterion
      needs a human at an emulator rather than a scripted pass. Carried by the
      same follow-up todo as AC #1. jsdom prop-plumbing tests are the only
      evidence behind this change today; they pin that the props are applied
      and cannot observe reachability in either direction.

## Implementation Notes

- Candidate shapes (pick one during implementation):
  1. Extend `useConfirmationModal()` to also return `isOpen` (state flipped in
     `confirm()` / the sheet's `onDismiss`), letting hosts wrap their content in
     a helper that applies `importantForAccessibility="no-hide-descendants"` +
     `accessibilityElementsHidden` while true.
  2. Have `ConfirmationModal` accept the host's content as children/prop and
     tag it internally — bigger API change, more uniform.
- Note `useSheetBackHandler` already observes sheet open/close transitions
  (`onSheetChange`) — the open-state signal may be derivable there rather than
  duplicated.
- jsdom cannot assert Android focus-trap semantics
  (docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md
  — though the hiding-prop pair does map to aria-hidden for direct assertions);
  the real verification is the emulator uiautomator diff.

## Scope Contract

- **Mechanisms to use:** existing hiding-prop pair convention; no new a11y
  abstractions beyond the hook API extension.
- **Files in scope:** `client/components/ConfirmationModal.tsx`, the 8 caller
  screens listed above, and their co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. PR #924 (in-app sign-out confirm) should land first so the
  Settings call site is stable.

## Risks

- TalkBack behavior of `no-hide-descendants` on a screen that is itself inside
  a navigator needs on-emulator verification — the uiautomator default dump
  cannot distinguish broken from fixed states.
- Android hardware is unavailable in this project (Apple-only); emulator-only
  verification is the accepted standard.

## Updates

### 2026-09-05

- Initial creation from mobile-reviewer WARNING on PR #924.

### 2026-09-16

- Residual 1 (navigator-rendered header stays reachable on 5 screens) closed
  by `todos/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md`:
  `useConfirmationModal()` now also returns `isOpen`, and Settings,
  SavedItems, GroceryLists, Pantry, and CookSessionReview each drive
  `navigation.setOptions()` from it (`headerBackVisible` for the native
  default back button; a re-rendered `headerLeft` for the two screens whose
  `RootStackNavigator`-hosted route has a custom close "X"). This bullet's
  count of "5" was already correct at the time it was written — no count
  correction was needed.
- AC #1 and AC #4 above are **still left unchecked, deliberately, for the
  same reason as 2026-09-13**: no Android SDK tooling (`adb`/`emulator`) is
  available in the authoring environment, and this project's hardware is
  Apple-only. The header-trap fix is implementation-complete and covered by
  jsdom-level prop-pinning tests (same limitation as the original
  `behindContentA11yProps` tests — jsdom cannot assert TalkBack/VoiceOver
  reachability), but neither AC has had a device-level TalkBack or VoiceOver
  pass. Re-deferred rather than falsely checked.

### 2026-09-13

- Implemented candidate shape 1: `useConfirmationModal()` now returns
  `behindContentA11yProps`, a memo-free `{accessibilityElementsHidden,
importantForAccessibility}` pair derived from internal `isOpen` state
  (flipped true in `confirm()`, false only once the sheet's own `onDismiss`
  fires — post close-animation, mirroring `useSheetBackHandler`'s bias).
  All 8 callers spread it onto their own top-level behind-content elements,
  per-element (no wrapper Views) except `SettingsScreen.tsx`, where 3
  `<Card>` instances needed a single-purpose wrapper because `Card.tsx`
  (out of this todo's Scope Contract) doesn't forward the props.
- **AC #1 and AC #4 left unchecked deliberately.** No Android SDK tooling
  (`adb`/`emulator`) is available in this environment (both exit 127), so
  the on-device `uiautomator dump --compressed` open-vs-closed diff could
  not be performed. The jsdom tests added to `ConfirmationModal.test.tsx`
  assert prop application only (the same `aria-hidden` mapping the
  pre-existing destructive-icon test relies on) — not TalkBack/VoiceOver
  reachability, which jsdom cannot assert.
- Three residuals identified in review, deliberately left out of this
  todo's scope (see PR body / DEFERRED_WARNINGS for detail):
  1. The native navigator header (back/close button) stays reachable on
     **5** header-hosted screens, not 3 — corrected after review counted
     them against `ProfileStackNavigator.tsx` and `RootStackNavigator.tsx`:
     Settings, SavedItems, GroceryLists, Pantry, CookSessionReview.
     `behindContentA11yProps` only reaches a screen's OWN render tree and
     cannot hide a sibling rendered by the navigator. The flagship case of
     this todo — Settings → Sign Out — is one of the 5, so the escape route
     it was written to close is still open at that surface. Now tracked by
     `todos/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md`.
  2. `CookSessionCaptureScreen`'s bare `<CameraView>` is the only sibling in
     that return block without the spread. DEFERRED, with the reason:
     `CameraViewProps` (`client/camera/types.ts:36`) is a closed interface
     with no rest-spread, so passing the props would mean editing
     `client/camera/` — outside this todo's Scope Contract. The alternative,
     wrapping the preview in an extra absolutely-positioned `View`, cannot be
     verified here: the simulator has no camera, so a layout or preview
     regression on a VisionCamera surface would ship unobserved. Real-world
     risk is low (a native camera preview has no focusable descendants), so
     deferring beats shipping an unverifiable change to a camera screen.
  3. This repo's jsdom mocks for `FlatList`/`SectionList`/`Animated.View`
     don't route accessibility props to `aria-hidden`. Counted per SITE:
     the 8 screens hold 23 spread sites, 17 observable (View 11,
     Pressable 4, ThemedText 1, ScrollView 1) and 6 not (FlatList 4,
     SectionList 1, Animated.View 1). The earlier "3 + 5 + 1 of 8" phrasing
     summed to 9 over 8 screens and mixed per-screen with per-site.
     Production behavior at those 6 IS correct — verified in RN source, not
     assumed: FlatList spreads `...restProps` into VirtualizedList, which
     builds `scrollProps = {...this.props}` and renders
     `<ScrollView {...props} />`; SectionList follows the same shape. The
     gap is in the MOCKS.
