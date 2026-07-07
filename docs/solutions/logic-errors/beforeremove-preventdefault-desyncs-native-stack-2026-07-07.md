---
title: "A hand-rolled beforeRemove + preventDefault() listener desyncs native-stack from JS state"
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-navigation, native-stack, hooks, navigation]
symptoms: ["Console error: '[Screen] was removed natively but didn't get removed from JS state'", "A screen intermittently renders blank after a back gesture, with the tab bar still responsive", "beforeRemove interception works empirically but produces a dev-only console warning"]
created: '2026-07-07'
---

# A hand-rolled beforeRemove + preventDefault() listener desyncs native-stack from JS state

## Problem

A screen needed to intercept the back action and redirect elsewhere instead of
letting the default pop happen. The straightforward implementation used
`navigation.addListener("beforeRemove", (e) => { e.preventDefault(); ... })`
directly. This worked in isolated testing, but under repeated
navigate-away/navigate-back cycles it produced the console error:

```
The screen 'X' was removed natively but didn't get removed from JS state.
This can happen if the action was prevented in a 'beforeRemove' listener,
which is not fully supported in native-stack. Consider using a
'usePreventRemove' hook with 'headerBackButtonMenuEnabled: false' to prevent...
```

and, separately, intermittent blank-screen renders when switching back to the
tab containing the intercepted screen (the JS navigation state still showed 2
routes; nothing was visibly wrong in the state, but the native view had already
been torn down).

## Symptoms

- The exact console warning above, naming the screen and `beforeRemove`.
- A screen that goes blank (no header, no content, but the tab bar still
  responds) shortly after a back gesture was intercepted and redirected
  elsewhere, without any other error.
- The bug is intermittent and timing-sensitive — it may not reproduce on the
  first attempt, making it easy to misdiagnose as a one-off rendering glitch.

## Root Cause

`@react-navigation/native-stack`'s own back gesture/button is driven by the
native UIKit/Android interactive-pop machinery, which can start (and in some
cases visually complete) tearing down the native view *before* JS's
`beforeRemove` listener has a chance to call `preventDefault()`. A plain
`navigation.addListener("beforeRemove", ...)` + `e.preventDefault()` only
tells the **JS** navigation state to keep the route — it does not tell
native-stack's native side to also cancel/hold its own gesture-driven removal.
The result: the native screen is gone, but JS still thinks it's mounted —
exactly the "removed natively but didn't get removed from JS state" warning.

## Solution

Use React Navigation's `usePreventRemove(preventRemove, callback)` instead of
a hand-rolled `beforeRemove` listener. It internally registers with
native-stack's `PreventRemoveContext`, which native-stack's own view layer
reads (see `NativeStackView.native.tsx`'s `usePreventRemoveContext()` /
`preventedRoutes` check) to hold the native side back too, not just the JS
state:

```ts
// Before — desyncs native-stack under its own back gesture
navigation.addListener("beforeRemove", (e) => {
  e.preventDefault();
  // ... redirect logic
});

// After — coordinates with native-stack's native view layer
usePreventRemove(true, (e) => {
  // ... redirect logic; usePreventRemove already called preventDefault()
});
```

Note the inverted control flow: `usePreventRemove`'s wrapper *unconditionally*
calls `preventDefault()` whenever its first argument is truthy, before your
callback runs — it does not let the callback decide whether to prevent. If the
screen must let *some* removals through unmodified (e.g. its own `replace()`
call, or a plain non-dirty exit), the callback must explicitly re-dispatch
those: `navigation.dispatch(e.data.action)`.

## Prevention

- Prefer `usePreventRemove` over a hand-rolled `beforeRemove` +
  `preventDefault()` listener whenever the screen is a `native-stack` screen
  and the interception needs to survive the native back gesture/button (not
  just an explicit JS `goBack()` call).
- If you must fall back to a hand-rolled listener for some reason, budget for
  empirical testing across multiple navigate-away/back cycles — the desync is
  timing-dependent and won't necessarily show up on the first pass.

## Related Files

- `client/hooks/useFromHomeBackRedirect.ts`
- `client/screens/meal-plan/RecipeCreateScreen.tsx`

## See Also

- `node_modules/@react-navigation/core/src/usePreventRemove.tsx`
- `node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx`
