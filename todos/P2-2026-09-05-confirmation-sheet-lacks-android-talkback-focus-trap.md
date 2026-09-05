---
title: "ConfirmationModal sheet lacks an Android TalkBack focus trap — background content stays swipeable behind it"
status: backlog
priority: medium
created: 2026-09-05
updated: 2026-09-05
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# ConfirmationModal sheet lacks an Android TalkBack focus trap

## Summary

`ConfirmationModal` (`@gorhom/bottom-sheet` portal overlay) sets only
`accessibilityViewIsModal`, which is iOS-only, so on Android TalkBack can swipe
past the presented sheet into the host screen's content behind it. All 8
`useConfirmationModal()` callers share the gap; PR #924 made it newly relevant
for a destructive flow (sign-out) that previously used a natively-isolated
`Alert.alert`.

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
- [ ] The mechanism covers all 8 existing `useConfirmationModal()` callers
      (CookSessionCapture, CookSessionReview, SavedItems, ChatList, BatchScan,
      GroceryLists, Pantry, Settings) without per-screen bespoke wiring where
      avoidable.
- [ ] iOS behavior (accessibilityViewIsModal) unchanged.
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
