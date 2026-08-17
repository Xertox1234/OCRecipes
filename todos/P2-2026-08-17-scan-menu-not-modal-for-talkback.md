---
title: "Scan menu is not modal for TalkBack — background Home content stays swipeable while the menu is open"
status: backlog
priority: medium
created: 2026-08-17
updated: 2026-08-17
assignee:
labels: [accessibility, react-native, deferred]
github_issue:
---

# Scan menu is not modal for TalkBack

## Background

Found during the VoiceOver scan-flow fix (`todos/P1-2026-08-07-scan-flow-unreachable-with-voiceover.md`,
branch `fix/voiceover-scan-menu-unreachable`) and independently confirmed by both 2026-08-17
reviewers. The Android emulator a11y-tree dump with the scan menu OPEN
(`todos/deployment/voiceover-scan-device-pass.md` → "NEW FINDING") shows the Home screen's
content — "Search Recipes", "Quick Log", "Recipes section", all four tab buttons — still
present in the tree. `accessibilityViewIsModal` (SpeedDial's wrapper) is iOS-only and nothing
mirrors it, so a TalkBack user can swipe out of the open menu into the screen behind it.

Pre-existing on `main` (the menu's containment was never correct on Android), and structurally
out of the P1 branch's scope: `SpeedDial` cannot fix it from inside — `ScanFAB` (and therefore
the SpeedDial it renders) mounts as a SIBLING of the whole `Tab.Navigator`
(`client/navigation/MainTabNavigator.tsx:204`), so the background it must hide is not in its
subtree. This is exactly the codified pattern
`docs/solutions/conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md`
going unapplied.

## Acceptance Criteria

- [ ] While the scan menu is open, the tab-navigator content (screens + tab bar) is absent
      from the Android a11y tree; restored when the menu closes.
- [ ] iOS behavior unchanged (`importantForAccessibility` is a no-op there;
      `accessibilityViewIsModal` keeps doing the iOS trapping).
- [ ] The mirror value comes from a tested pure function (precedent: `getScanOverlayA11y` in
      `client/screens/ScanScreenConfirmOverlay-utils.ts`), applied per-element per the
      convention doc — not via a new wrapper `View` (wrapper re-scoping flips paint order of
      absolutely-positioned zIndex children).
- [ ] Verified with a before/after `uiautomator dump --compressed` diff on the emulator
      (`Medium_Phone_API_36.1`) — count `content-desc` occurrences; `focusable=false` is NOT
      evidence of exclusion. TalkBack focus order itself is permanently unverifiable (no
      Android device — Apple-only hardware).

## Implementation Notes

- Menu-open state lives in `ScanFAB` (`client/components/ScanFAB.tsx`, `menuOpen`); the
  content to hide is rendered by `client/navigation/MainTabNavigator.tsx`. The state must be
  lifted or shared (context, or lift `menuOpen` into the navigator that renders both).
- Hide the tab content + tab bar subtrees with `importantForAccessibility="no-hide-descendants"`
  / restore `"auto"` — mirror of the iOS modal trap, per the convention doc.
- The SpeedDial wrapper itself must stay `"auto"` (it is the surface that remains reachable).
- Reviewer note (mobile-reviewer, 2026-08-17): this finding also caps how much the shutter's
  new a11y state matters on Android in chip-visible phases — same
  `importantForAccessibility` mechanics, same verification method.
