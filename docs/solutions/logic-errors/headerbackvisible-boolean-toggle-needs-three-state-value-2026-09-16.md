---
title: "Toggling headerBackVisible dynamically alongside a custom headerLeft needs a three-state value, not a boolean"
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-navigation, native-stack, react-native-screens, accessibility, navigation, hooks]
applies_to: ["client/screens/**/*.tsx"]
symptoms: [A native header back/close control stays reachable by TalkBack/VoiceOver while a bottom-sheet overlay is presented even though headerLeft was set to render null, Toggling headerBackVisible to hide the header control while an overlay is open causes a duplicate native back arrow to appear alongside a custom close button once the overlay closes, headerBackVisible and a dynamically-toggled headerLeft interact only on Android and only when headerTitle is a function]
created: '2026-09-16'
---

# Toggling headerBackVisible dynamically alongside a custom headerLeft needs a three-state value, not a boolean

## Problem

A screen dynamically hides its React Navigation native-stack header's back/close control
while a `ConfirmationModal`-style bottom sheet is presented, so TalkBack/VoiceOver can't
swipe past the sheet to the header (the sheet's own focus trap can hide the screen's own
render tree, but not the header, which the navigator renders as a sibling). The natural
first attempt — `navigation.setOptions({ headerLeft: isOpen ? () => null : <original> })`
— is not sufficient on Android. Fixing that with `headerBackVisible: !isOpen` closes the
reachability hole but reopens a DIFFERENT bug in the closed state: a duplicate back control
(native arrow + custom close button) both visible and both functional whenever the sheet is
NOT open, i.e. during normal use.

## Symptoms

- On Android, `headerLeft: () => null` alone does not hide the native back/up control from
  TalkBack while an overlay is open, even though the custom left element itself is gone.
- After adding `headerBackVisible: !isOpen` to fix the above, the header shows BOTH a
  native back arrow AND a custom close button simultaneously whenever the sheet is closed
  (the default, most common state) — a visual and functional duplication, not a crash.
- The issue is invisible on iOS and invisible when the route has no custom `headerLeft`
  (i.e. relies on the native default back button only) — it is specific to routes that
  combine a dynamically-toggled `headerBackVisible` with a custom `headerLeft`.

## Root Cause

Two react-native-screens computations govern Android header reachability, and they don't
share the same input the way the naive fix assumes:

1. `@react-navigation/native-stack`'s `useHeaderConfigProps.tsx` computes
   `hideBackButton: headerBackVisible === false` and separately
   `backButtonInCustomView = headerBackVisible || (Platform.OS === "android" &&
   headerTitleElement != null && headerLeftElement == null)`.
2. `react-native-screens`' Android `ScreenStackHeaderConfig.kt` uses `hideBackButton` to
   drive `actionBar.setDisplayHomeAsUpEnabled(canNavigateBack() && !isBackButtonHidden)`,
   and separately uses `backButtonInCustomView` to guard
   `if (!backButtonInCustomView) { toolbar.navigationIcon = null }` — the statement that
   nulls out the native back arrow's drawable so only the custom `headerLeft` view is left
   visible.

`backButtonInCustomView` is an OR: as soon as `headerBackVisible` is set to `true`
(explicitly, not left `undefined`), the OR short-circuits to `true` regardless of whether a
custom `headerLeft` element is present — which SKIPS the `toolbar.navigationIcon = null`
statement, leaving the native back arrow drawn. A plain `!isOpen` toggle evaluates to
`headerBackVisible: true` in the closed state (`isOpen === false`), which is exactly when
this fires — and it is the common, default state, not the rare one.

Setting `headerBackVisible: false` (when `isOpen === true`) is safe and necessary — it
forces `isBackButtonHidden = true`, which independently collapses
`setDisplayHomeAsUpEnabled(...)` to `false`, closing the original reachability hole. The bug
is specifically in using `true`/`!isOpen` for the OTHER state.

`ScreenModalFragment.kt` hardcodes `canNavigateBack(): Boolean = true` for modal-presented
screens, so `canNavigateBack()` can't be used as the lever — `headerBackVisible` is the only
one available.

On iOS the same flag is live, so the rule below is platform-agnostic — do NOT read this
section as license to use a plain boolean toggle on an iOS-only screen.
`RNSScreenStackHeaderConfig.mm:660` sets `navitem.hidesBackButton = config.hideBackButton`
from the same `headerBackVisible === false` boolean, and `RNSScreenStackHeaderConfig.mm:678`
*additionally* assigns `navitem.leftItemsSupplementBackButton = config.backButtonInCustomView`
inside the `RNSScreenStackHeaderSubviewTypeLeft` case (guarded `#if !TARGET_OS_TV`). UIKit's
`leftItemsSupplementBackButton` displays a custom left bar button item ALONGSIDE the system
back button rather than replacing it — the same duplication shape as Android. So a route with
a custom `headerLeft` that explicitly sets `headerBackVisible: true` can duplicate the back
control on iOS too.

The two platforms differ in WHEN that path is reached, not in whether it exists. Verify the
trigger against the source rather than from this paragraph: the `backButtonInCustomView`
computation and the subview-rendering condition both live in
`@react-navigation/native-stack/src/views/useHeaderConfigProps.tsx` (the OR's second term
involves `headerLeftElement == null`, and a `Left` subview also renders for a function
`headerTitle`). The Android composition is the one actually reproduced in this repo.

## Solution

Use a three-state value, not a plain boolean toggle:

```tsx
navigation.setOptions({
  headerBackVisible: isOpen ? false : undefined,
  headerLeft: isOpen ? () => null : () => <YourCustomLeftElement />,
});
```

`undefined` (not the key omitted, and not `true`) is what restores the closed-state
behavior correctly: `headerBackVisible` typically has no STATIC value configured on a route
that also has a custom `headerLeft` (unlike `headerLeft` itself, which usually has a static
navigator-level definition — restoring THAT via `headerLeft: undefined` is a separate,
unsafe move: `@react-navigation/core`'s `setOptions` merges by spreading onto prior override
state, so an explicit `undefined` there would PERMANENTLY replace a static custom
`headerLeft` with the native default, not fall back to it), so a dynamic `undefined` on
`headerBackVisible` correctly reproduces "never set" rather than shadowing a prior value.
Both native reads of `headerBackVisible` (`=== false` and OR-truthiness) treat `undefined`
identically to the key never having been passed.

## Prevention

- Never toggle `headerBackVisible` with a plain boolean (`!isOpen`, `isOpen`) on a route
  that ALSO sets a custom `headerLeft` dynamically. Use `isOpen ? false : undefined`.
- When adding ANY dynamic header-hiding mechanism for accessibility on Android, trace it
  through BOTH `hideBackButton` and `backButtonInCustomView` in
  `useHeaderConfigProps.tsx` — they are two independent computations that can each hide or
  reveal the same control through a different code path, and a fix for one can silently
  break the other.
- A route with only the native default back button (no custom `headerLeft`) never hits this
  interaction — `backButtonInCustomView`'s Android OR-term is already forced by
  `headerLeftElement == null`, so `headerBackVisible` alone is sufficient and safe to toggle
  with a plain boolean there.
- Two independent code-review passes were needed to catch both halves of this (open-state
  reachability, then closed-state duplication) — when reviewing a similar dynamic
  header-visibility change, explicitly check BOTH the "overlay open" and "overlay closed"
  states against both native computations, not just the state the fix was written for.

## Related Files

- `client/screens/meal-plan/GroceryListsScreen.tsx`
- `client/screens/meal-plan/PantryScreen.tsx`
- `client/components/ConfirmationModal.tsx`
- `todos/archive/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md`

## See Also

- [native-stack-back-dispatches-pop-not-goback-2026-07-07.md](native-stack-back-dispatches-pop-not-goback-2026-07-07.md)
