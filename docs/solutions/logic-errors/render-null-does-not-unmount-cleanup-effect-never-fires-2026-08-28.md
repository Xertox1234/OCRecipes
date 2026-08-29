---
title: A component that conditionally `return`s `null` never unmounts — an unmount-only cleanup effect silently never fires
track: bug
category: logic-errors
tags: [react, react-native, useEffect, cleanup, state-lifting, accessibility]
module: client
symptoms: [A guard meant to reset state "when the component goes away" never runs because the component only stops rendering, it never actually unmounts, State lifted into a parent that does not unmount stays orphaned at its last value with no way left in the UI to reset it, A code comment says "reset on unmount" but the trigger condition described in the comment is actually a conditional `return null`, not React unmounting the component]
severity: high
created: '2026-08-28'
---

# A component that conditionally `return`s `null` never unmounts — an unmount-only cleanup effect silently never fires

## Problem

A component with `if (someCondition) return null;` still has every hook it declared before that
line mounted and live — including a `useEffect(() => cleanup, [])`'s cleanup function, which is
an **unmount** trigger, not a "stopped rendering" trigger. When state the component drives has
been lifted into a parent that does NOT unmount alongside it, an unmount-only cleanup effect is a
no-op for exactly the scenario its own comment usually claims to guard against.

## Symptoms

- A `useEffect(() => { return () => resetSomething(); }, [])` exists specifically to reset state
  "when the component goes away," but the component's actual disappearance is a conditional
  `return null`, not an unmount.
- Manually triggering an `unmount()` in a test makes the guard pass, but that test path is not
  reachable by the running app the way the code comment describes.
- Lifted/shared state gets orphaned at a stale value with no UI affordance left to reset it,
  because the component that used to own the state (and the effect that would reset it) stopped
  rendering instead of unmounting.

## Root Cause

`return null` is a normal render output — React keeps the component instance, its state, and its
effects mounted; only the DOM/native output disappears. The **only** thing that fires a
`useEffect`'s cleanup outside of a dependency change is the owning component actually leaving the
tree (removed by its parent, or the parent itself unmounting). A condition that makes a component
render `null` (a feature flag, a "not on this screen" guard, a permissions check) is a completely
different lifecycle event from unmounting, and confusing the two produces a guard that looks
correct by inspection — the comment reads plausibly — but is dead code for its stated purpose.

Concretely in `client/components/ScanFAB.tsx`: `menuOpen` was lifted into `MainTabNavigator`
(which never unmounts) so it could also drive an Android accessibility trap on the tab content
behind the scan menu. `ScanFAB` has `if (!isOnRootScreen) return null` — a navigation transition
that makes `isOnRootScreen` false does **not** unmount `ScanFAB`. (`isOnRootScreen`'s own exact
selector semantics — precisely which transitions flip it — are pre-existing and were not
independently re-derived by this fix; a `code-reviewer` pass on PR #873 flagged this as unverified
and it is out of that PR's scope to resolve.) An `unmount`-only cleanup effect written to reset an
orphaned `menuOpen: true` therefore never fired for whatever case DOES flip `isOnRootScreen`,
leaving every tab + the tab bar permanently hidden from the Android accessibility tree with no
FAB/SpeedDial left to close the menu — a worse, unrecoverable state than the pre-fix bug.

## Solution

Identify the actual condition that should trigger the reset (here, `isOnRootScreen` going
`false`) and key a normal effect on it directly, guarded by the state that needs resetting:

```tsx
// Force-close the menu when navigation moves off the root screen while it's
// still open. `isOnRootScreen` going false does NOT unmount ScanFAB — it
// only makes it `return null` — so a plain unmount-cleanup effect never
// fires here.
useEffect(() => {
  if (!isOnRootScreen && menuOpen) {
    closeMenu();
  }
}, [isOnRootScreen, menuOpen, closeMenu]);
```

This effect must be declared **before** the `if (!isOnRootScreen) return null;` line — hooks
still need to run on every render regardless of what the component eventually returns.

## Prevention

- Before writing (or trusting) an unmount-cleanup effect (`useEffect(() => cleanup, [])`), name
  the specific condition the comment says should trigger the reset, then check: does that
  condition actually remove the component from its parent's JSX, or does the component just
  render `null`/`false`/`undefined` while remaining mounted? Only the former unmounts.
  Grep the component for an early `return null` (or a parent that conditionally omits
  `<Component/>` from JSX) using the *same* condition named in the reset comment — if they match,
  the "unmount" framing is wrong.
- When state is lifted out of a component into a parent that has a longer lifetime, audit every
  place the now-orphaned-if-stale state could stop being resettable — a conditional-render guard
  in the child is the most common one, since it looks like the child "goes away."
- Test the reset via the actual triggering condition (e.g. flipping a mocked navigation state and
  `rerender`ing), not via a test harness's `unmount()` call — `unmount()` proves the cleanup
  function exists, not that anything in the running app calls it.

## Related Files

- `client/components/ScanFAB.tsx` — the `isOnRootScreen`-keyed effect (correct version)
- `client/components/__tests__/ScanFAB.test.tsx` — `rerender` + mutable mocked nav state exercises
  the real trigger, not `unmount()`
- `client/navigation/MainTabNavigator.tsx` — the parent that lifted `menuOpen` and does not
  unmount alongside `ScanFAB`

## See Also

- [In-screen modal overlays need an Android focus trap, not just iOS accessibilityViewIsModal](../conventions/in-screen-overlay-needs-android-focus-trap-2026-06-22.md) — the feature this bug was found while implementing
- [Capture inner setTimeout handles at outer effect cleanup](../conventions/capture-inner-settimeout-handles-outer-effect-2026-05-13.md) — a different unmount-cleanup pitfall (stale closures), not this one (wrong trigger entirely)
