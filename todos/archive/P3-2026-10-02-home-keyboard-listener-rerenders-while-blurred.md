---
title: "HomeScreen's keyboard-show listener re-renders the blurred Home tab on every keyboard show app-wide — gate the setter on Home focus"
status: done
priority: low
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, performance, react-native]
github_issue:
---

# Home keyboard listener re-renders while blurred

## Summary

`client/screens/HomeScreen.tsx:272-286` subscribes to `keyboardWillShow` (iOS) / `keyboardDidShow` (Android) unconditionally, and its updater always returns a fresh object (`shows: prev.shows + 1`), so every keyboard show anywhere in the app re-renders Home while it sits unfocused behind another tab (Coach, Plan, Profile). The render is pure overhead: the focus-effect cleanup at `:437` has already nulled the open drawer on blur, so `bottomPadding` (`:288-293`) cannot change and the glide effect (`:373-377`) returns on the null ref. Gate the listener on Home focus (about 10 lines) and pin it with one Vitest case.

## Background

Noticed during the `/todo` sweep PR #1217 (`c09fb445`, "Home: the keyboard covers an inline drawer's input when the page is short"), whose executor recorded it as "Known, not fixed" in `todos/archive/P2-2026-09-26-home-keyboard-covers-inline-drawer-input.md:97-98` rather than widen that PR's contract. Verified 2026-10-02 against main `ec26b972`:

- The listener effect has `[]` deps and no focus or drawer gate (`client/screens/HomeScreen.tsx:273-286`); the updater at `:277-283` always produces a new object, so React's `Object.is` bail-out never fires.
- The `Keyboard` emitter is app-wide, and Home stays mounted behind the other tabs: `grep -rnE 'enableFreeze|freezeOnBlur|unmountOnBlur|popToTopOnBlur|detachInactiveScreens' client` (which covers `client/App.tsx`) exits 1, `client/navigation/MainTabNavigator.tsx` sets only animation / tab-bar / header options, and the installed `@react-navigation/bottom-tabs` 7.8.11 defaults `freezeOnBlur` to `false`.
- `client/screens/HomeScreen.tsx` is in the committed React Compiler bailout baseline (`scripts/react-compiler-bailout-baseline.json:62`), so the whole function body and every non-`memo` child re-run on each show.
- No fix on main (no `useIsFocused`/`isFocusedRef` in the file; `c09fb445` is its newest commit) and no open todo mentions keyboard, drawer or HomeScreen.

Severity low: one wasted render per keyboard show, nothing visible, no state change. The per-render cost is unmeasured and cannot be measured statically; a device measurement was not required to file this, so the recipe is recorded below as an optional criterion. Deferred because it is self-contained code+test work outside #1217's scope; filed per the CLAUDE.md Low-severity auto-file rule once the owner approved the triage filing on 2026-10-02.

## Acceptance Criteria

- [ ] While Home is blurred, a keyboard show records nothing: with `useIsFocused` returning `false`, `fireKeyboard("Show")` followed by `openQuickLog()` leaves `paddingBottom()` at `BASE_PADDING` — new case "ignores a keyboard show while Home is blurred" in the keyboard-inset block of `client/screens/__tests__/HomeScreen.test.tsx` (`:470`). Its denominator is the focused twin at `:555` ("applies a keyboard height it already saw as soon as a drawer opens"), which pads to `KEYBOARD + Spacing.lg` on the same sequence and must stay green unchanged.
- [ ] The navigation mock at `client/screens/__tests__/HomeScreen.test.tsx:139-144` is toggleable per test through a hoisted holder that the keyboard block's `beforeEach` (`:494`) resets to focused, and every existing case in the file passes without modification — in particular `:547` and `:555`, which record a keyboard height while NO drawer is open. The gate is on focus, never on `hasOpenDrawer`.
- [ ] `client/screens/HomeScreen.tsx` reads focus from a ref inside the listener callback; there is no `ref.current = x` write in the component body (hooks rule — it would give this file a second compiler-bailout reason on top of the one at `:354`), the subscription is still created once with `[]` deps, and "removes its keyboard listener on unmount" (`:655`) stays green.
- [ ] `client/screens/__tests__/HomeScreen.render-item-stability.test.tsx` still passes untouched (its navigation mock at `:118-122` already exports `useIsFocused: () => true`, so the new import resolves there).
- [ ] `node scripts/check-react-compiler-bailouts.js` (chained onto `npm run lint`, CI-enforced) reports no NEW bailout — HomeScreen is already listed, and the change adds none elsewhere.
- [ ] Optional, only if someone wants the number: on a dev build (`npx expo run:ios`) use React DevTools Profiler, or a temporary `console.count("HomeScreen render")` at the top of the component body, while typing in Coach, and compare before/after. A simulator with a hardware keyboard attached never renders the soft keyboard — synthesize `keyboardWillShow` per `docs/solutions/best-practices/synthesize-ios-keyboard-events-over-cdp-when-the-sim-has-a-hardware-keyboard-2026-10-01.md`, or toggle the software keyboard (I/O → Keyboard). Not required to close this todo.

## Implementation Notes

Primary approach — mirror `useIsFocused()` into a ref and early-return in the listener. This is the exact pattern `client/hooks/useSheetBackHandler.ts:100-110` already runs on this same screen, and it is the "ref read later, in an async callback" case `docs/rules/hooks.md` carves out for the `useEffect`-mirror (the Keyboard callback is invoked by the native event emitter, not during render, so the one-frame lag is invisible).

- `client/screens/HomeScreen.tsx:20` — extend the import: `import { useNavigation, useFocusEffect, useIsFocused } from "@react-navigation/native";`.
- Beside the keyboard state at `:272`, add:
  ```ts
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);
  ```
- In the listener callback (`:276-283`), return before the setter while blurred, so no update is queued at all (cheaper than `return prev`, which still runs React's eager bail-out):
  ```ts
  (event) => {
    if (!isFocusedRef.current) return;
    setKeyboard((prev) => ({
      /* unchanged */
    }));
  };
  ```
  The effect keeps its `[]` deps; the ref is what carries focus into the long-lived callback.
- Extend the comment block above `:272` with one sentence: shows are ignored while Home is blurred because the focus-effect cleanup (`:429-440`) nulls the drawer on blur, so a blurred show could only re-render for nothing.
- Do NOT write `isFocusedRef.current = isFocused` in the component body (`docs/rules/hooks.md`: React Compiler rejects render-time ref writes). Do NOT gate on `hasOpenDrawer` (`:260`) — tests `:547` and `:555` depend on recording a height with no drawer open.

Alternative, only if `useIsFocused` is unwanted: drive the ref from the existing `useFocusEffect` at `:429-440` (`isFocusedRef.current = true` at the top of the callback, `false` in the cleanup). Cost: both test files stub `useFocusEffect: () => {}` (`client/screens/__tests__/HomeScreen.test.tsx:141`, `client/screens/__tests__/HomeScreen.render-item-stability.test.tsx:120`), so neither ever runs the callback; the stub would have to become `useEffect`-shaped with the holder deciding whether to invoke it, and its cleanup would then also run `setOpenDrawerId(null)` in tests. More mock surgery for the same ten lines — prefer the primary.

Test (`client/screens/__tests__/HomeScreen.test.tsx`):

- Add `focusHolder: { value: true }` to the `vi.hoisted` block at `:40-70`, and change `:143` to `useIsFocused: () => focusHolder.value`. `useSheetBackHandler` (a real collaborator) reads the same mock; toggling it to `false` only affects its Android back-press path, which no case in this file exercises.
- In the keyboard-inset block's `beforeEach` (`:494-503`), add `focusHolder.value = true;` so a blurred case cannot leak into the next one.
- New case, placed right after `:555` so the twin pair reads together; it reuses the block's helpers `fireKeyboard`, `openQuickLog`, `paddingBottom` and `BASE_PADDING` (`:472-492`) and leaves `measureHolder` at its `beforeEach` null (a set `measureHolder` would make the drawer-open glide call `scrollTo` and muddy the assertion):
  ```ts
  it("ignores a keyboard show while Home is blurred (another tab's keyboard must not drive Home's state)", () => {
    focusHolder.value = false;
    renderComponent(<HomeScreen />);
    fireKeyboard("Show");
    openQuickLog();
    // The focused twin above pads to KEYBOARD + Spacing.lg here; a blurred
    // show recorded no height, so the drawer opens at the base padding.
    expect(paddingBottom()).toBe(BASE_PADDING);
  });
  ```
- Optional second pin for `shows`: open the drawer first with `measureHolder.value = { pageY: 600 }`, `vi.mocked(scrollTo).mockClear()`, fire a blurred `Show`, and expect `scrollTo` not called — the inverse of `:591` ("glides again on every keyboard show"). The padding assertion above is the required one.

TDD order: add the new case first and watch it fail (padding becomes `KEYBOARD + Spacing.lg` today), then land the gate.

## Scope Contract

- **Mechanisms to use:** `useIsFocused()` plus the `useRef`/`useEffect` focus mirror exactly as in `client/hooks/useSheetBackHandler.ts:100-110`; the test file's existing `vi.hoisted` holders and keyboard-inset helpers. Nothing new.
- **Files in scope:** `client/screens/HomeScreen.tsx`, `client/screens/__tests__/HomeScreen.test.tsx`. Read-only must-still-pass: `client/screens/__tests__/HomeScreen.render-item-stability.test.tsx` (edit it only if the alternative approach is taken, and say so under "Out of contract" in the PR body).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #1217 is merged (`c09fb445`). Not blocked on the compiler-suppression item below.

## Risks

- Out of scope, recorded by the verifier: the single `react-hooks/exhaustive-deps` suppression at `client/screens/HomeScreen.tsx:354` keeps the whole file out of React Compiler coverage (`scripts/react-compiler-bailout-baseline.json:62`), so every keyboard-driven render — the ones this todo removes and the ones it keeps — runs unmemoized. Removing that suppression is a separate change; do not fold it in here.
- Behaviour change at the margin: a keyboard height first seen while Home was blurred is no longer remembered. On Home, tapping a drawer's input makes it first responder, which re-posts will-show on iOS, so the height is recorded and the glide runs then. The one sequence that differs is a keyboard carried over from another tab with a drawer opened on Home before its input is tapped — before, it padded at once; after, it pads on the tap. If a device check shows that matters, return `prev` only when the reported height is unchanged (remember a changed height without bumping `shows`); the common same-height show still bails out.
- `useIsFocused()` subscribes Home to focus/blur, i.e. one extra render per tab switch in each direction — far fewer than one per keyboard show, and the screen already carries such a subscription through `useSheetBackHandler` (the examined trade-off in `todos/archive/P3-2026-07-09-usesheetbackhandler-duplicate-isfocused-listeners.md`).
- The toggleable mock also feeds `useSheetBackHandler`'s own `isFocusedRef`; keep the holder reset in `beforeEach` so a blurred case cannot leak into a later test.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.

### 2026-10-04

- Implemented: Home keyboard-show listener gated on focus via useIsFocused ref mirror; new blurred test in HomeScreen.test.tsx. Optional device-profiler criterion not run.
