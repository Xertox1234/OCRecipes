---
title: "accessibilityViewIsModal does not suppress LATER siblings — a modal rendered before its trigger leaves the trigger focusable"
track: bug
category: logic-errors
tags: [accessibility, react-native]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["VoiceOver can still focus and activate an element that should be trapped out by an open modal overlay", "A modal's focus order ends with an element rendered OUTSIDE the modal wrapper", "Activating that leaked element performs its non-modal behavior (e.g. toggles the modal closed) — reads as 'the menu just closes'"]
created: 2026-08-17
severity: high
---

# accessibilityViewIsModal does not suppress LATER siblings — a modal rendered before its trigger leaves the trigger focusable

## Problem

On iOS, `accessibilityViewIsModal` suppresses only siblings ordered **before** the
modal view in the accessibility hierarchy. Siblings rendered **after** it (and/or
stacked above it with a higher `zIndex`) remain fully focusable and activatable
while the "modal" is open. Code that renders `{open && <Overlay/>}` first and the
triggering button second reads as correctly scoped — the wrapper says modal — but
the trigger is never trapped.

Found on-device in the SpeedDial scan menu
(`todos/P1-2026-08-07-scan-flow-unreachable-with-voiceover.md`, defect D): the
FAB rendered after `<SpeedDial>` with `zIndex: 1000` vs the wrapper's `999`,
stayed focusable while the menu was open, and its toggle handler dismissed the
menu without navigating — one of two independent causes of the reported "it just
closes the screen."

## Symptoms

- Device pass shows an out-of-modal element announced (often LAST — that is
  where a later/higher sibling sorts in frame order) while the modal is open.
- The same source-level diagnosis wrongly concludes the element "is removed from
  the a11y tree by `accessibilityViewIsModal`" — the claim reads plausibly and
  is falsified only by a device swipe-through.

## Root Cause

UIKit's modal containment walks the accessibility hierarchy and stops exposing
elements that precede the modal view; it does not look forward. Render order and
z-order therefore silently decide whether a sibling is trapped, and the
higher/later sibling is exactly where a floating trigger button naturally lives.

## Solution

Two orderings work; pick one deliberately:

- Render the trigger **before** the modal overlay so containment covers it, or
- keep the trigger after/above the modal **on purpose** as the labelled
  close/escape affordance (its label must then flip to the close action, e.g.
  "Close scan menu") — and give the modal its own canonical exits
  (`onAccessibilityEscape`, Android `BackHandler`) so the leaked element is a
  designed exit, not an accident.

A hidden full-screen backdrop inside the modal can defeat containment from the
other direction (see the See Also links) — fixing that is what makes the
sibling-order behavior observable at all.

## Prevention

- Never assert "X is suppressed by `accessibilityViewIsModal`" from source
  reading alone when X is a later or higher-zIndex sibling — verify with a
  device swipe-through (iOS) or `uiautomator dump --compressed` diff (Android).
- When reviewing an in-screen modal, check the JSX position and zIndex of every
  sibling of the modal wrapper, not just the wrapper's props.

## Related Files

- `client/components/ScanFAB.tsx` — trigger rendered after `<SpeedDial>`, kept
  deliberately as the labelled close affordance
- `client/components/SpeedDial.tsx` — the modal wrapper with the per-platform
  exits

## See Also

- [In-screen modal overlays need an Android focus trap, not just iOS accessibilityViewIsModal](../conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md) — the Android half of the same containment problem
- [Modal focus trapping with accessibilityViewIsModal](../design-patterns/modal-focus-trapping-2026-05-13.md) — the base pattern this gotcha refines
- [accessibilityViewIsModal must go on the sheet's content View](../conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md) — placement gotcha in the same family
