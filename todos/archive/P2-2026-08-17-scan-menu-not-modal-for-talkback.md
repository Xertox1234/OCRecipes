---
title: "Scan menu is not modal for TalkBack — background Home content stays swipeable while the menu is open"
status: done
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

- [x] While the scan menu is open, the tab-navigator content (screens + tab bar) is absent
      from the Android a11y tree; restored when the menu closes.
- [x] iOS behavior unchanged (`importantForAccessibility` is a no-op there;
      `accessibilityViewIsModal` keeps doing the iOS trapping). Verified live on the iOS
      Simulator (2026-08-28): the menu opens/closes identically to pre-fix behavior — blurred
      backdrop, all 6 action rows, FAB flips to the close affordance — no layout or paint
      regression from the new wrapper `View`.
- [x] The mirror value comes from a tested pure function (precedent: `getScanOverlayA11y` in
      `client/screens/ScanScreenConfirmOverlay-utils.ts`), applied per-element per the
      convention doc — not via a new wrapper `View` (wrapper re-scoping flips paint order of
      absolutely-positioned zIndex children). **Justified exception (2026-08-28, code review):**
      `Tab.Navigator` (`@react-navigation/bottom-tabs`) has no prop that reaches
      `importantForAccessibility` — verified against the installed package's
      `createBottomTabNavigator.d.ts` / `types.d.ts`. `screenOptions.sceneStyle` does exist as
      a style passthrough, but it's scene-scoped (styles only the active screen, not the tab
      bar this pattern also needs hidden) and `ViewStyle`-typed (`importantForAccessibility`
      is an accessibility prop, not a style property) — so per-element application directly
      onto it is still not possible. A single-purpose `<View testID="tab-content-a11y-wrapper">` wraps only
      `<Tab.Navigator>` in `client/navigation/MainTabNavigator.tsx`; it's non-positioned with no
      `zIndex` and does not reparent `<ScanFAB />` (still a same-level sibling below it), so it
      doesn't hit the paint-order failure mode the AC's own rationale warns about.
- [x] Verified with a before/after `uiautomator dump --compressed` diff on the emulator
      (`Medium_Phone_API_36.1`) — count `content-desc` occurrences; `focusable=false` is NOT
      evidence of exclusion. TalkBack focus order itself is permanently unverifiable (no
      Android device — Apple-only hardware). **Device evidence (2026-08-28):** logged in as
      `demo`, on Home. Menu closed (before): 72 `content-desc` entries, including
      `Search Recipes`/`Quick Log`/tab-bar labels. Menu open (after): 18 `content-desc`
      entries, ALL belonging to the SpeedDial menu itself (`Batch Scan`, `Close scan menu`,
      `Photo Food Log`, `Scan Barcode`, `Scan Menu`, `Scan Nutrition Label`, `Scan Receipt`) —
      zero tab-content bleed-through. Menu closed again (restored): 72 entries, and a
      line-for-line `diff` against the original before-dump's sorted `content-desc` list is
      byte-identical (zero delta).

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
