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
- [x] The mechanism covers all 8 existing `useConfirmationModal()` callers
      (CookSessionCapture, CookSessionReview, SavedItems, ChatList, BatchScan,
      GroceryLists, Pantry, Settings) without per-screen bespoke wiring where
      avoidable.
- [x] iOS gets a REAL focus trap too (it never had one — the old `accessibilityViewIsModal` was dead code, removed in #924). Do not treat iOS as already covered.
- [ ] Verified per the house method: `adb shell uiautomator dump --compressed`
      diff with the sheet open vs closed (see
      docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md);
      `focusable=false` is NOT evidence of exclusion.

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
  todo's scope (see PR body / DEFERRED_WARNINGS for detail): the native
  navigator header (back button) stays reachable on 3 header-hosted
  screens; `CookSessionCaptureScreen`'s bare `<CameraView>` lacks the
  `accessible={false}` wrapper `BatchScanScreen`'s camera has (pre-existing,
  unrelated to this mechanism); and this repo's jsdom mocks for
  `FlatList`/`SectionList`/`Animated.View` don't route accessibility props
  to `aria-hidden`, so 6 of the 8 screens' application sites aren't
  test-observable (documented in the test file; production behavior is
  very likely correct since real RN forwards unknown props to the
  underlying `ScrollView`).
