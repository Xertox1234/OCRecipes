---
title: "@gorhom/bottom-sheet defaults accessible=true, collapsing the sheet's whole subtree into one a11y leaf on iOS new-arch — content unreachable by VoiceOver and Maestro"
track: bug
category: logic-errors
tags: [react-native, accessibility, testing, design-system, ios]
module: client
applies_to: ["client/**/*.tsx"]
symptoms: ["a BottomSheetModal's title/message/buttons are absent from the iOS view hierarchy dump while the sheet container ('Bottom Sheet') IS present", "a Maestro tapOn/assertVisible on text or testID inside a bottom sheet never matches on iOS", "VoiceOver reads a presented sheet as one 'Bottom Sheet, adjustable' element with no way to reach its contents", "the same selectors work in a jsdom render test (the mock renders children plainly) but fail on device"]
created: 2026-09-05
last_updated: 2026-09-13
severity: high
---

# @gorhom/bottom-sheet collapses its subtree into one a11y leaf on iOS new-arch

## Problem

A `BottomSheetModal` (`@gorhom/bottom-sheet`) presented on iOS with the New
Architecture (Fabric) exposes **one** accessibility element labelled
`"Bottom Sheet"` (role `adjustable`) with **no descendants**. Every element
inside — titles, messages, buttons, inputs, and their `testID`s — is invisible
to VoiceOver and to Maestro's iOS driver, even though it renders on screen and
appears normally in a jsdom render test. Driving or asserting sheet content on
iOS is impossible by construction.

This bit the #908 sign-out migration: replacing a native `Alert.alert` with the
`useConfirmationModal` sheet made the confirm text/`"Yes, Sign Out"` button
deterministically unmatchable on iOS — a worse failure than the intermittent
one it replaced.

## Symptoms

See frontmatter. The tell in a Maestro hierarchy dump: a `"Bottom Sheet"` node
present with its content children missing. A jsdom test will NOT catch it — the
`@gorhom/bottom-sheet` mock renders children as plain DOM, so `getByText`
passes while the device fails. Verify on a simulator with `inspect_screen`.

## Root Cause

Sourced through `node_modules/@gorhom/bottom-sheet`:
- `components/bottomSheet/constants.ts` — `DEFAULT_ACCESSIBLE = true`,
  `DEFAULT_ACCESSIBILITY_LABEL = 'Bottom Sheet'`, role `'adjustable'`.
- `BottomSheetModal` does not destructure `accessible`, so the default rides
  `...bottomSheetProps` → `BottomSheet` → `BottomSheetContent`, which applies
  `accessible` + `accessibilityLabel` to the `DraggableView` that **wraps
  `children`**.
- RN Fabric (`RCTViewComponentView.mm`): `accessible → isAccessibilityElement =
  YES`. iOS treats an accessibility element as a **leaf** — its descendants are
  removed from the UIAccessibility tree, which is what XCUITest/Maestro read.

New arch is on (`ios/Podfile.properties.json` `newArchEnabled: true`).

## Solution

Pass `accessible={false}` to the `BottomSheetModal`:

```tsx
<BottomSheetModal
  ref={sheetRef}
  accessible={false}   // keep children individually exposed to VoiceOver + Maestro
  ...
>
```

- **Must be `false`, not `null`:** gorhom resolves it as
  `_providedAccessible ?? undefined`, so `null` re-defaults to `true`.
- Verified on device (iPhone 17 Pro / iOS 26.5, `inspect_screen`): with the
  prop, the sheet's title, message, `Cancel`, and `Yes, Sign Out` each appear
  as reachable descendants and the `Yes, Sign Out` tap completes the logout.
- This is a genuine a11y improvement for **every** `useConfirmationModal`
  caller (8 screens), not an E2E-only hack.

Also drop any `accessibilityViewIsModal` passed to `BottomSheetModal` — gorhom's
`BottomSheet` has no rest-spread, so the prop is silently dropped; it is dead
code and false assurance of a focus trap (the real cross-platform trap is a
separate follow-up).

## Real-world confirmation

Extending the fix to the remaining 8 sites surfaced a real occurrence of the
exact no-op the Prevention section warns about: `MealPlanHomeScreen.tsx`'s 4
`BottomSheetModal` sites were found carrying the dead `accessibilityViewIsModal`
directly on the `BottomSheetModal` wrapper — confirmed as a real occurrence,
not just a hypothetical. It was removed alongside adding `accessible={false}`.

Why it never reaches a native view — the prop does travel, then stops.
`BottomSheetModal` DOES have a rest-spread: it destructures
`...bottomSheetProps` (`BottomSheetModal.tsx:61`) and spreads it onto
`<BottomSheet>` (`:547`), so `accessibilityViewIsModal` rides that far.
`BottomSheet.tsx` is where it dies — it destructures explicitly, has no
rest-spread at all (`grep -cE '\.\.\.rest|\.\.\.props\b'` → `0`), and forwards
only `accessible` / `accessibilityLabel` / `accessibilityRole` onward. Nothing
passes the remainder to a native view.

Stated this way deliberately: an earlier revision of this paragraph said all
three components "have zero rest-spreads", which is false for
`BottomSheetModal` and contradicts this file's own Root Cause section above
(which correctly describes the default riding `...bottomSheetProps`). The
functional conclusion was right and the supporting fact was wrong — and since
this doc auto-injects on every `client/**/*.tsx` edit, the wrong half would
have been read as authoritative on the next prop-forwarding question.
Contrast `BottomSheetView`, which DOES spread `...rest` onto a real native
View — which is why `accessibilityViewIsModal` works there and not on the
wrapper.

## Testing pattern for multiple simultaneous sheets

For a screen with multiple simultaneous `BottomSheetModal` instances (e.g.
`MealPlanHomeScreen`'s 4 sheets), the shared `test/mocks/gorhom-bottom-sheet.ts`
mock's fixed `data-testid='bottom-sheet-modal'` cannot distinguish instances.
Such a test file needs its own local `vi.mock('@gorhom/bottom-sheet', ...)`
override that captures each instance's `accessible` prop keyed by a stable
per-instance identifier (e.g. `snapPoints[0]`), asserting the captured value
directly rather than querying the DOM. See
`client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` for the worked
example.

## Prevention

- Any new `BottomSheetModal`/`BottomSheetView` whose content must be reachable
  by assistive tech or E2E needs `accessible={false}` on the modal.
- Never trust a jsdom render test to prove sheet content is reachable on iOS —
  the mock renders children plainly and cannot see the native leaf-collapse.
  Confirm with `inspect_screen` on a simulator.
- When migrating a native `Alert.alert`/dialog to an in-app sheet, verify the
  new surface's content is actually exposed on device before claiming parity.

## Related Files

- `client/components/ConfirmationModal.tsx` — `accessible={false}` on the modal
- the 8 `useConfirmationModal` callers (CookSessionCapture/Review, SavedItems,
  ChatList, BatchScan, GroceryLists, Pantry, Settings) — all inherit the fix
- `todos/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md`
  — the separate focus-trap follow-up
- `client/screens/HomeScreen.tsx` — `accessible={false}` added
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — `accessible={false}` added to all 4 sheets
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — `accessible={false}` added
- `client/screens/meal-plan/RecipeEntryHubScreen.tsx` — `accessible={false}` added
- `client/components/BeveragePickerSheet.tsx` — `accessible={false}` added

These 5 files were the remaining 8 `BottomSheetModal` sites from the archived
`todos/P2-2026-09-05-bottomsheetmodal-callers-collapse-a11y-subtree-on-ios`;
`ConfirmationModal.tsx` above was the first site fixed.

## See Also

- [An app-owned native alert can render on screen while absent from the a11y hierarchy](app-alert-renders-on-screen-but-absent-from-a11y-hierarchy-2026-09-05.md) — the #908 mode this migration addressed; this a11y-leaf defect was the second layer it exposed
- [An iOS system dialog REPLACES the app's accessibility hierarchy](ios-system-dialogs-replace-the-a11y-hierarchy-2026-08-30.md) — the native-dialog cousin