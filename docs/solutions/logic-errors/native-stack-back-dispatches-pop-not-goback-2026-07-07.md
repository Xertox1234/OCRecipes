---
title: React Navigation's native-stack header back button dispatches POP, not GO_BACK
track: bug
category: logic-errors
module: client
severity: high
tags: [react-navigation, native-stack, hooks, navigation]
symptoms: [beforeRemove listener that checks action.type === "GO_BACK" never fires on a real device/simulator tap, Custom back-button interception works in unit tests but silently does nothing on device, Mocked GO_BACK action in a test passes while the real feature is broken]
created: '2026-07-07'
---

# React Navigation's native-stack header back button dispatches POP, not GO_BACK

## Problem

A `beforeRemove` listener meant to intercept the user tapping "back" (to redirect
elsewhere instead of the default pop) checked `e.data.action.type === "GO_BACK"`.
The listener was correctly registered and correctly skipped irrelevant actions like
`REPLACE`, and a unit test that fired a mocked `{ type: "GO_BACK" }` action passed.
But tapping the actual header back button (or using the iOS swipe-back gesture) in
the simulator never triggered the interception — the default pop always won.

## Symptoms

- A back-action interceptor (redirect, confirm-dialog, etc.) never fires when the
  user taps the native header back chevron or swipes back.
- The exact same interceptor *does* fire when triggered via an explicit
  `navigation.goBack()` JS call.
- A unit test that mocks the `beforeRemove` event with `{ type: "GO_BACK" }` passes,
  giving false confidence that the real device behavior is covered.

## Root Cause

`@react-navigation/native-stack`'s header back button and the iOS/Android
swipe-back gesture both dispatch `StackActions.pop()` — action type `"POP"` — not
`CommonActions.goBack()` (`"GO_BACK"`). Only an *explicit* `navigation.goBack()`
call from JS produces a `GO_BACK` action. A `beforeRemove`/`usePreventRemove`
callback that only checks for `"GO_BACK"` silently ignores the `POP` action the
native UI actually dispatches, so it never runs for the two ways a real user
normally goes back.

This was caught only via runtime instrumentation (`console.log`-ing
`e.data.action.type` inside the listener during simulator testing) — the mocked
unit test could not have caught it, since the mock supplied the wrong action type
to begin with.

## Solution

Check for both action types wherever a `beforeRemove`/`usePreventRemove` callback
needs to distinguish "the user went back" from other removals (e.g. the screen's
own `replace()`/`navigate()` calls):

```ts
const BACK_ACTION_TYPES = new Set(["GO_BACK", "POP"]);

usePreventRemove(true, (e) => {
  if (!BACK_ACTION_TYPES.has(e.data.action.type)) {
    navigation.dispatch(e.data.action); // not a back action — let it proceed
    return;
  }
  // ... handle the back action
});
```

And make sure any unit test covering this exercises **both** action types, not
just `GO_BACK` — otherwise the test can pass while the real-device behavior is
broken, exactly as happened here (`it.each(["GO_BACK", "POP"])(...)`).

## Prevention

- Never assume a `beforeRemove` action's `type` based on how you'd *dispatch* a
  back action from JS (`goBack()`) — check what native-stack's UI actually
  dispatches, which differs by trigger (button vs. gesture vs. explicit call).
- When testing back-navigation interception, verify empirically on a real
  simulator/device tap, not only via a mocked unit test — a mock can encode the
  same wrong assumption the implementation made.

## Related Files

- `client/hooks/useFromHomeBackRedirect.ts`
- `client/hooks/__tests__/useFromHomeBackRedirect.test.ts`
- `client/screens/meal-plan/RecipeCreateScreen.tsx`
