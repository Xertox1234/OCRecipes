---
title: "@gorhom/bottom-sheet's onChange fires when a sheet's animation completes, not when it starts — a state-derivation dead window"
track: bug
category: logic-errors
module: client
severity: medium
tags: [gorhom-bottom-sheet, bottom-sheet, react-native, android, backhandler, animation-timing, race-condition]
applies_to: [client/hooks/*.ts, client/**/*.tsx]
symptoms: ['Any derived "is the sheet open" state that updates only from BottomSheetModal.onChange is briefly wrong (still reads closed) for the ~200-300ms duration of the sheet''s opening spring/timing animation.', "A consumer of that derived state (e.g. a hardware-back handler, an overlay dimmer, a focus trap) behaves as if the sheet were closed while it is visibly open and animating.", "The OPENING half of the bug reproduces only on imperatively-presented sheets (no React isOpen state driving presence); state-driven sheets that mirror their own trigger state via useEffect are unaffected on the opening edge, but ARE affected on the CLOSING edge if that same effect flips the ref closed directly from the boolean instead of waiting for onChange(-1) (see the 2026-07-09 update below).", "Hard to catch by casual manual testing: the window is sub-second, so a slow/deliberate interaction during that window is needed to trigger it."]
created: 2026-07-07
last_updated: 2026-07-09
---

# @gorhom/bottom-sheet's onChange fires when a sheet's animation completes, not when it starts

## Problem

`BottomSheetModal`'s `onChange(index)` prop looks like the natural way to derive "is this sheet currently presented" for a host that has no React state of its own (i.e. calls `.present()` imperatively from a press handler, with nothing tracking presented-ness). It is not sufficient on its own: `onChange` is invoked from gorhom's `animateToPositionCompleted` internals — it fires once an open/close animation **finishes**, not when it starts. Between `.present()` being called and the animation completing (a few hundred ms of spring/timing motion), any state derived purely from `onChange` still reads "closed" even though the sheet is visibly on screen and animating open.

This surfaced while implementing a shared `useSheetBackHandler` hook (Android hardware-back-dismisses-open-sheet): the hook derived presented-ness from `onChange` alone for imperative hosts. A code-review pass (mobile-reviewer, round 1) caught that a back press during the opening animation would fall through — the exact bug the hook existed to fix — because the ref driving the BackHandler callback hadn't flipped to "open" yet.

## Symptoms

- A ref/state variable meant to track "sheet is presented," derived only from `onChange`, reads stale (`false`/closed) during the sheet's opening animation.
- Any consumer gated on that derived state (back-button interception, backdrop press-through, focus management, etc.) misbehaves specifically in that sub-second window — before the animation completes it acts as if there's no sheet.
- Unit/integration tests that call `onChange` directly (skipping the animation) never catch this — they jump straight to the post-animation state and never exercise the gap.
- Manual QA usually misses it too: normal tap-then-interact timing is often *slower* than the animation, so the window closes before a human notices; it shows up more reliably with rapid/automated input.

## Root Cause

`@gorhom/bottom-sheet` exposes two distinct lifecycle callbacks with different timing, and their names don't make the distinction obvious:

- **`onChange(index, position?, type?)`** — fires from `animateToPositionCompleted`, i.e. **after** the open/close animation finishes and the sheet has settled at its target snap point (or fully closed, `index === -1`).
- **`onAnimate(fromIndex, toIndex, fromPosition, toPosition)`** — fires (via `runOnJS`, so JS-thread-async but effectively immediate — one frame, not deferred to animation completion) **before** the animation begins, at the moment a transition is kicked off.

Verified directly against library source (`node_modules/@gorhom/bottom-sheet/src/components/bottomSheet/BottomSheet.tsx`): `handleOnAnimate` is invoked prior to the `animate(...)` call that drives the transition; `handleOnChange`/`animateToPositionCompleted` fires only once that animation's completion callback runs. `BottomSheetModalProps extends BottomSheetProps`, so both props pass through `BottomSheetModal` unchanged.

Using `onChange` alone to derive "is the sheet open" is therefore only correct for **settled** state — it has a built-in blind spot for the entire duration of any in-flight animation, which is exactly the situation a real user is looking at (a sheet mid-slide is still a sheet the user perceives as "open").

## Solution

Track two things, not one, when deriving presented state for an imperative host:

1. Wire `onAnimate` and flip the "open" flag to `true` as soon as `toIndex >= 0` — this closes the gap during the *opening* animation, since it fires at the moment the transition starts.
2. Wire `onChange` and flip the flag to `false` only when `index === -1` (fully closed) — do **not** flip it closed from `onAnimate` when `toIndex === -1`, since that fires at the *start* of the closing animation, while the sheet is still fully visible.

This is an intentionally asymmetric bias: during a close animation the derived state stays "open" a little longer than the sheet is technically settled at. A consumer racing against that lag (e.g. a back-button handler) just re-triggers dismiss on an already-closing sheet — harmless — rather than ever risking a false "closed" read while the sheet is still on screen.

```ts
const isOpenRef = useRef(false);

const onSheetChange = useCallback((index: number) => {
  isOpenRef.current = index >= 0;
}, []);

const onSheetAnimate = useCallback((_fromIndex: number, toIndex: number) => {
  if (toIndex >= 0) {
    isOpenRef.current = true;
  }
  // Deliberately no `else`: closing is left to onSheetChange (never flips
  // the ref closed here) — see the asymmetric-bias note above.
}, []);

// Wire BOTH on the BottomSheetModal:
// <BottomSheetModal onChange={onSheetChange} onAnimate={onSheetAnimate} ... />
```

For **state-driven** hosts (a screen already tracks `isOpen`/trigger state in React and mirrors it into a ref via `useEffect` for an async callback to read), the *opening* half of this gap doesn't apply — the ref is set directly from the trigger state at the moment `.present()` is called, not from a gorhom callback, so there's no animation-timing lag on the way in.

**Update (2026-07-09) — the *closing* half of this gap DOES apply to state-driven hosts, and the original write-up above missed it.** A state-driven host that mirrors `isOpen` both ways (`isOpenRef.current = isOpen` on every change, via a plain `useEffect(() => { isOpenRef.current = isOpen; }, [isOpen])`) has the SAME dead-window bug as the imperative case, just on the other edge: when an in-sheet action handler synchronously flips the trigger state to a falsy/null value (e.g. `setAddItemMenuMealType(null)`), the ref flips `false` immediately — before the sheet's ~300ms close animation has visually finished. A back press (or any other consumer of that ref) during that window sees "closed" while the sheet is still on screen. This surfaced in `client/screens/meal-plan/MealPlanHomeScreen.tsx`'s 4 state-driven sheets and was fixed the same way as the imperative case: apply the SAME asymmetric bias to state-driven hosts too.

```ts
// Fixed: the isOpen effect only ever OPENS the ref — closing is confirmed
// exclusively by onSheetChange(-1), exactly like the imperative case.
useEffect(() => {
  if (isOpen) {
    isOpenRef.current = true;
  }
  // Deliberately no `else` — see the asymmetric-bias note above.
}, [isOpen]);
```

This means a state-driven host now has a **required** obligation it didn't have before: it MUST also wire the hook's `onSheetChange` onto the BottomSheetModal's `onChange` prop (previously this was optional/no-op for state-driven hosts, since the boolean alone used to fully drive both edges). **Footgun: a state-driven host that passes `isOpen` but forgets to wire `onSheetChange` now leaves the ref permanently stuck "open" after the first close** — worse than the original bug, since it silently swallows every subsequent back press for that ref. There is no compile-time signal for this — same type shape, `tsc` passes either way. A static presence-check script (`scripts/check-bottomsheet-backhandler.js`, added alongside this fix) catches a `BottomSheetModal` host that never calls `useSheetBackHandler(` at all, but it does NOT catch a host that calls the hook yet forgets to wire the returned `onSheetChange` — that gap is still open (see `todos/archive/P3-2026-07-07-usesheetbackhandler-edge-cases.md`).

**Related gotcha found in the same fix, worth flagging here since it's easy to miss:** when multiple `BottomSheetModal` hosts on the same screen each call `useSheetBackHandler`, every call registers its own `BackHandler.addEventListener` — and Android's `BackHandler` consults listeners in **reverse registration order** (last-registered first; see `node_modules/react-native/Libraries/Utilities/BackHandler.android.js`). During a same-screen sheet handoff (closing sheet A, then opening sheet B from within A's own action handler), which sheet's listener "wins" a stray back press depends on which `useSheetBackHandler(...)` call is declared later in the component — swap the declaration order and a back press can silently dismiss the wrong (stale) sheet instead of the one currently visible. No type error, no isolated unit test catches this (each hook instance is typically tested alone) — it only shows up when several instances share one screen. Document declaration-order dependence with an inline comment wherever multiple `useSheetBackHandler` calls coexist in one component.

## Prevention

- Any time you derive "is this BottomSheetModal open" purely from `onChange` for a host with no `isOpen` state of its own, ask: does anything read that derived state *during* the open/close animation, not just after it settles? If yes, wire `onAnimate` too.
- Don't trust `onChange`'s name to imply "fires on every transition" — it specifically means "the sheet has arrived and settled."
- Unit tests for this kind of derived state must simulate calling `onAnimate` before `onChange` (mirroring gorhom's real ordering) and assert the mid-animation state explicitly — a test that only calls the settled-state callback cannot distinguish a correct implementation from one with the dead window (see `client/hooks/__tests__/useSheetBackHandler.test.ts`, the "stays open across the close animation" case, for the one assertion that actually catches a naive `isOpenRef.current = toIndex >= 0` implementation vs. the correct guarded version).
- When in doubt about gorhom callback timing, verify against `node_modules/@gorhom/bottom-sheet/src/components/bottomSheet/BottomSheet.tsx` rather than assuming from prop names — the two callbacks are easy to conflate.

## Related Files

- `client/hooks/useSheetBackHandler.ts` — the hook that surfaced this; `onSheetAnimate`/`onSheetChange` implement the fix above, now applied to BOTH usage modes (the `isOpen`-mirror effect only ever opens the ref; closing is confirmed exclusively by `onSheetChange(-1)`).
- `client/hooks/__tests__/useSheetBackHandler.test.ts` — test coverage for the animation-start vs. animation-complete ordering, the state-driven closing-grace-period case, and the `useIsFocused()` focus-scoping gate.
- `client/screens/HomeScreen.tsx`, `client/screens/meal-plan/RecipeEntryHubScreen.tsx`, `client/components/BeveragePickerSheet.tsx`, `client/components/ConfirmationModal.tsx`, `client/screens/meal-plan/RecipeBrowserScreen.tsx` — imperative hosts wiring both callbacks.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — the 4 state-driven hosts that surfaced the 2026-07-09 closing-gap update; all 4 `useSheetBackHandler` calls now wire `onSheetChange`/`onSheetAnimate` too, and their declaration order (addItemMenu first) is load-bearing for same-screen sheet-crossover back-press correctness (see the LIFO note above).
- `scripts/check-bottomsheet-backhandler.js` — static presence check added alongside the 2026-07-09 fix; catches a host that never calls `useSheetBackHandler(` but NOT one that calls it without wiring `onSheetChange`.

## See Also

- [../runtime-errors/bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md](../runtime-errors/bottomsheetmodal-in-child-component-silently-fails-to-present-2026-07-02.md) — a different gorhom BottomSheetModal gotcha (presentation, not callback timing) in the same subsystem.
