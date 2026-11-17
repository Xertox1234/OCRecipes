---
title: A Maestro tap by text can land on a same-named label or an off-screen match and do nothing — tap a testID, or go through a visible uniquely named element
track: bug
category: logic-errors
tags: [testing, maestro, e2e, ios, accessibility]
module: client
applies_to: ["e2e/**"]
symptoms: ["tapOn a switch's text is COMPLETED and the switch does not change", "tapOn with a regex and index 0 is COMPLETED and no sheet opens", "the next assertion fails although the tap step is green"]
created: 2026-11-16
severity: medium
---

# A Maestro tap by text can land on a same-named label or an off-screen match and do nothing

## Problem

Two taps in `e2e/flows/plan/family-profiles.yaml` were reported COMPLETED and changed nothing. Both were measured on the iOS simulator with the Maestro CLI.

1. `tapOn: "Plan for my family"` did not toggle the switch. The row's visible text and the `Switch`'s `accessibilityLabel` are the same string, and Maestro tapped the text.
2. `tapOn: { text: '.* snack, empty, add a meal', index: 0 }` did not open the add menu. The week grid scrolls horizontally and opens at today; index 0 was Sunday's cell, in the hierarchy but off-screen to the left. Adding `below: 'Today, .*'` picked an off-screen cell as well.

## Symptoms

- The tap step is green; the first failure is the wait or assertion after it.
- The failure screenshot shows the screen exactly as it was before the tap.

## Root Cause

Text matching is against the whole hierarchy. It does not prefer the element that reacts to a tap, and it does not skip elements outside the viewport. A native `Switch` only toggles when the switch itself is tapped; a tap on a sibling `Text` does nothing unless the row is pressable.

## Solution

Give the control a `testID` and tap by id:

```yaml
- tapOn:
    id: "family-planning-switch"
```

For a scrolled grid or list, reach the target through an element that is known to be on screen and uniquely named, instead of a regex over repeated cells:

```yaml
- tapOn: 'Today, .*' # the day header the grid opens at
- scrollUntilVisible:
    element: 'Add .* item'
    direction: DOWN
- tapOn:
    text: 'Add .* item'
    index: 0
```

## Prevention

- A control whose accessibility label repeats nearby visible text gets a `testID`, and the flow taps the id.
- Before committing a flow, run its steps against the live app (`maestro --device <udid> test <file>` with the dev build's `appId`), in parts if the account state does not allow one run. A selector copied from the source is not a checked selector.
- When a step that should open something is followed by a failing wait, take a `simctl io` screenshot: the accessibility snapshot can return the previous screen's tree.

## Related Files

- `e2e/flows/plan/family-profiles.yaml`
- `client/components/profile/InlineSettings.tsx` — `testID="family-planning-switch"`
- `client/components/meal-plan/week-grid-utils.ts` — `getCellAccessibilityLabel`, `getDayHeaderAccessibilityLabel`

## See Also

- [a tap reports success but the app never saw it](maestro-tap-reports-success-but-the-app-never-saw-it-2026-10-28.md) — a dropped tap, where re-tapping helps; here re-tapping does not
- [auto-retap untoggles toggles](maestro-auto-retap-untoggles-toggle-controls-2026-08-30.md) — why a toggle is checked by its resulting state
