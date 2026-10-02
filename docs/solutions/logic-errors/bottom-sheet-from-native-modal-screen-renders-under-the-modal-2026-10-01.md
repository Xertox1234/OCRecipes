---
title: "A gorhom BottomSheetModal opened from a native-modal screen renders under the modal — the sheet is 'open' but invisible and untappable"
track: bug
category: logic-errors
tags: [react-native, bottom-sheet, navigation, native-stack, modal, accessibility, ios]
module: client
applies_to: [client/navigation/RootStackNavigator.tsx, client/screens/**/*.tsx, client/components/**/*.tsx, client/hooks/**/*.ts]
symptoms: ["Tapping a button that should open a confirm/bottom sheet does nothing visible on a modal or full-screen-modal screen", "The same sheet works on tab-stack screens", "VoiceOver finds the screen's content gone after the tap (the sheet's isOpen hides it) while nothing is drawn", "A full-screen modal's close button does nothing, trapping the user"]
created: '2026-10-01'
severity: high
---

# A BottomSheetModal opened from a native-modal screen renders under the modal

## Symptom

On iOS, on screens registered with `presentation: "modal"` or `"fullScreenModal"`, `useConfirmationModal()` "opened" but showed nothing. The simulator showed this on 2026-10-01:

- **CookSessionCapture (full-screen):** with ingredients detected, the close X did nothing, however many times it was tapped. A full-screen modal can't be swiped away, so the user was trapped.
- **CookSessionReview (modal):** "Remove ingredient" did nothing.
- **Earlier, from Profile → Grocery Lists (root-modal copy):** delete did nothing visible.

The tell is in the accessibility tree: after the tap, the screen's controls drop out. `behindContentA11yProps` only hides them when the sheet's `isOpen` is true. So `confirm()` ran and the sheet is "open", just not anywhere the user can see.

## Root cause

A `BottomSheetModal` portals into the **nearest** `BottomSheetModalProvider`. The app had one provider, in `client/App.tsx`, *above* `NavigationContainer`. On iOS, react-native-screens presents a `modal` or `fullScreenModal` route as a separate view controller on top of the root one. The provider's portal host lives in the root view controller's views, so the sheet renders beneath the presented modal.

Vitest can't see this, because screen tests mock the sheet library.

## Fix

Give each native-modal screen that can open a sheet its own provider, *inside* the modal, using the route's `layout` prop (React Navigation 7):

```tsx
function withSheetProvider({ children }: { children: React.ReactElement }) {
  return <BottomSheetModalProvider>{children}</BottomSheetModalProvider>;
}

<Stack.Screen
  name="CookSessionCapture"
  component={CookSessionCaptureScreen}
  layout={withSheetProvider}
  options={{ presentation: "fullScreenModal" }}
/>
```

**Per screen, not navigator-wide `screenLayout`:** the wrapper re-homes sheets to a nested portal. Applying it only to the affected modal routes leaves every tab-stack sheet on the root provider it was verified with.

**No extra `GestureHandlerRootView` is needed:** on the simulator, dragging the sheet down inside a `fullScreenModal` dismissed it. Re-check this if a sheet inside a modal stops responding to drags.

The alternative fix, `containerComponent={FullWindowOverlay}` on the sheet, lifts it into a window-level overlay. That changes every host and has known gesture-handler interactions, so it was not used.

## Guard

`scripts/__tests__/native-modal-sheet-provider.test.ts` parses `RootStackNavigator.tsx`. For each screen with a native-modal `presentation`, it walks the screen's value imports, stopping at other screens and at `navigation/`. Any screen that can reach a `BottomSheetModal` import must carry `layout={withSheetProvider}`.

- **Parser detail:** blocks are split on the next `<Stack.Screen`, not matched to `/>`. An options callback can contain JSX (`<HeaderTitle … />`) before `presentation`.
- **Sheet detection:** it detects any `BottomSheetModal` import, not a list of known sheet modules. `RecipeBrowserScreen` declares its filter sheet inline.

On the old tree the test failed for exactly 7 of 29 native-modal screens:

- PhotoAnalysis (beverage picker)
- CookSessionCapture
- CookSessionReview
- BatchScan
- GroceryListsModal
- PantryModal
- RecipeBrowserModal

The last three were Coach-only root copies, deleted later the same day when the Coach's links moved into the Coach stack (see `bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`). That left 4 of 25. No root screen now sets `presentation` after JSX, so the parser's control for that shape runs on an inline sample.

## Scope notes

- Android native-stack `modal` is not a separate window, so this is iOS-visible. The wrapper is harmless there.
- A sheet opened from a *nested* navigator presented modally would need the same treatment; today only the root stack presents modals.
