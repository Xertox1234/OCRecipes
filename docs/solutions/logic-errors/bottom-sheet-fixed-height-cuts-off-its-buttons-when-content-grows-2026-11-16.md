---
title: A bottom sheet with a fixed height cap or fixed snap points cuts off its own buttons when the content grows — scroll the content and size the cap from the window
track: bug
category: logic-errors
tags: [react-native, accessibility, design-system, bottom-sheet, gorhom, dynamic-type]
module: client
applies_to: ["client/components/ConfirmationModal.tsx", "client/components/**/*Sheet.tsx", "client/screens/**/*.tsx"]
symptoms: ["a sheet shows its title and message but no buttons; the bottom of the sheet runs off the screen", "the accessibility snapshot of an open sheet lists the message text and the backdrop but no confirm or cancel button", "the last option of a menu sheet is cut in half at a larger text size", "component tests for the sheet all pass"]
created: 2026-11-16
severity: high
---

# A bottom sheet with a fixed height cap or fixed snap points cuts off its own buttons when the content grows

## Problem

Two sheets lost their last controls below the bottom of the screen, and nothing in the test suite noticed.

- `ConfirmationModal` used `enableDynamicSizing` with `maxDynamicContentSize={350}` and a plain `BottomSheetView`. The health-consent prompt (`HEALTH_CONSENT_PROMPT`) grew when it started naming the AI companies. At the default iOS text size its content needs about 400pt, so "Not now" and "Agree" sat below the screen and could not be pressed. Every screen that asks for that consent was affected: nobody could give or refuse it.
- `AddItemMenuSheet` uses fixed snap points. Adding the "Who's it for?" row pushed "Suggest a meal" below the sheet at the largest standard text size.

## Symptoms

- The sheet opens, shows its title and message, and has no buttons. Swiping inside it does nothing.
- An accessibility snapshot lists the message and "Bottom sheet backdrop" but no button.
- Every jsdom test passes, including ones that press the buttons.

## Root Cause

`maxDynamicContentSize` and snap points are hard limits on the sheet's height. Content taller than the limit is laid out in full and clipped, and a `BottomSheetView` does not scroll. The limit was chosen for the text that existed when the sheet was written; longer copy, an added row, or a larger text size all push past it.

jsdom has no layout, so a button that is rendered but off-screen is found and pressed by the tests like any other.

## Solution

Put the sheet's content in a `BottomSheetScrollView`, and derive any cap from the window:

```tsx
export function getConfirmationSheetMaxHeight(windowHeight: number): number {
  return Math.round(windowHeight * 0.85);
}

const { height: windowHeight } = useWindowDimensions();

<BottomSheetModal
  enableDynamicSizing
  maxDynamicContentSize={getConfirmationSheetMaxHeight(windowHeight)}
>
  <BottomSheetScrollView testID="confirmation-modal-scroll" bounces={false}>
    {/* title, message, buttons */}
  </BottomSheetScrollView>
</BottomSheetModal>
```

Dynamic sizing still works with `BottomSheetScrollView` (gorhom v5), so short content sizes exactly as before. For a sheet with fixed snap points, wrapping the content in `BottomSheetScrollView` is enough.

When the wrapper is added around a content root that carries `accessibilityViewIsModal`, move that prop to the scroll view: it must sit on the content's outermost element.

## Prevention

- A sheet's content is always in a scroll container. A height cap is a share of the window, never a number of points.
- When copy shown in a shared sheet gets longer, or a row is added to a menu sheet, open that sheet in the simulator at the default and the largest standard text size (`xcrun simctl ui <udid> content_size extra-extra-extra-large`, then relaunch the app: the running app does not pick the change up).
- A pure helper for the cap plus a test that the content sits in the scroll container (the element with the `-scroll` testID contains the title and the last button) is what jsdom can pin. It cannot prove the layout; the simulator pass does.

## Related Files

- `client/components/ConfirmationModal.tsx` — `getConfirmationSheetMaxHeight`, `BottomSheetScrollView`
- `client/components/meal-plan/AddItemMenuSheet.tsx` — fixed snap points, content in `BottomSheetScrollView`
- `client/lib/health-consent.ts` — the prompt whose length exposed the cap

## See Also

- [dynamic sizing for minimal-content sheets](../design-patterns/enable-dynamic-sizing-minimal-content-sheets-2026-05-13.md) — the pattern this cap belonged to
- [viewIsModal on sheet content](../conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md) — where the focus-trap prop must live
