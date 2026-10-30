---
title: "Edge-to-edge Android puts pageSheet headers under the status bar and tab labels under the navigation buttons — add the inset on Android only"
track: bug
category: logic-errors
tags: [react-native, design-system]
module: client
applies_to: ["client/components/**/*.tsx", "client/navigation/**/*.tsx", "client/constants/theme.ts"]
symptoms: ["Sheet title and close button drawn under the clock and status icons on Android", "Tab bar labels hidden behind the 3-button navigation bar on Android", "Both look right on iOS and in the iOS simulator"]
created: 2026-10-29
severity: medium
---

# Edge-to-edge Android puts pageSheet headers under the status bar and tab labels under the navigation buttons — add the inset on Android only

## Problem

Both bugs came from iOS-tuned layout running in an edge-to-edge Android window. Expo no longer lets an app opt out of edge-to-edge, and Android 16 enforces it.

1. **pageSheet headers (#1595).** Android ignores `presentationStyle="pageSheet"` and opens a full window that starts at the top of the screen. The cookbook, grocery-list and recipe-generation sheets padded their header by `Spacing.lg` only, which is right on iOS, where the sheet is a card below the status bar. On Android the header went under the status bar.
2. **Tab bar (#1596).** React Navigation puts the bottom safe-area inset *inside* the fixed `height` it is given. On iOS the 72 dp `TAB_BAR_HEIGHT` already allows for the home indicator. On Android the inset is the system navigation bar, so the labels ended up under the navigation buttons.

## Symptoms

- Phone screenshots showed the header and tab labels overlapping system UI. The `uiautomator` bounds confirmed it (tab labels at y=2217, nav buttons from y=2205).
- No test or iOS check could catch it.

## Root Cause

Each layout read "the platform handles the inset". That's true on iOS (a sheet card, a home-indicator allowance) and false on edge-to-edge Android.

## Solution

Two small pure helpers, each adding the inset on Android only and tested on both platforms:

```ts
// client/components/page-sheet-utils.ts
pageSheetHeaderPaddingTop(insets.top)   // Spacing.lg (+ insets.top on Android)
// client/constants/theme.ts
tabBarHeight(insets.bottom)             // TAB_BAR_HEIGHT (+ insets.bottom on Android)
```

Anything positioned against the tab bar uses the same helper (`ScanFAB`, `SpeedDial`), so it moves with the bar.

## Prevention

- A new `pageSheet` modal header uses `pageSheetHeaderPaddingTop`. A new layout that depends on the tab bar's height uses `tabBarHeight()` or `useBottomTabBarHeight()`, never the raw constant.
- Check layout changes on the Android phone with `adb exec-out screencap -p` plus `uiautomator dump` bounds. A navigator or shared-component change may not fast-refresh, so force-stop and relaunch before judging.

## Related Files

- `client/components/page-sheet-utils.ts`, `client/components/__tests__/page-sheet-utils.test.ts`
- `client/components/CookbookPickerModal.tsx`, `client/components/GroceryListPickerModal.tsx`, `client/components/RecipeGenerationModal.tsx`
- `client/constants/theme.ts` (`tabBarHeight`), `client/navigation/MainTabNavigator.tsx`, `client/components/ScanFAB.tsx`, `client/components/SpeedDial.tsx`

## See Also

- [toast over an RN Modal needs a modal toast host](../design-patterns/toast-over-rn-modal-needs-a-modal-toast-host-2026-10-18.md) — the same Android pageSheet behaviour, for the toast's top inset
- [useBottomTabBarHeight for tab screen bottom padding](../conventions/usebottomtabbarheight-tab-screen-bottom-padding-2026-05-13.md)
