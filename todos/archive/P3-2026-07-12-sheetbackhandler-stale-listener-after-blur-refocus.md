<!-- Filename: P3-2026-07-12-sheetbackhandler-stale-listener-after-blur-refocus.md -->

---

title: "useSheetBackHandler: hardware back stops dismissing a sheet after a blur/refocus round-trip"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, ui-ux, android, hooks]
github_issue:

---

# useSheetBackHandler: hardware back stops dismissing a sheet after a blur/refocus round-trip

## Summary

On `MealPlanHomeScreen`, after opening a `BottomSheetModal`-backed sheet, navigating away via a
deep link (blurring but not unmounting the screen), and pressing hardware back to return, further
hardware-back presses no longer dismiss the still-open sheet — even though the screen has
regained focus. Tap-to-dismiss on the sheet's backdrop still works instantly in the same state,
and a _freshly re-opened_ sheet responds to back normally again, so this is scoped to the specific
sheet instance that was open during the blur, not a global regression.

## Background

Discovered on-device while verifying `todos/archive/P3-2026-07-09-usesheetbackhandler-ondevice-verification.md`
(AC2, the focus-scoping fix from PR #555). AC2 itself passed cleanly — the stale blurred-screen
listener correctly did NOT consume a back press meant for the newly-focused screen (`FeaturedRecipeDetail`
popped via React Navigation as expected). This is a separate, adjacent observation from the _same_
test sequence: once back on `MealPlanHomeScreen` with the sheet still open, a _further_ back press
(tested twice) failed to dismiss it.

Repro sequence (Android emulator, `Medium_Phone_API_36.1`, `-gpu host`):

1. On `MealPlanHomeScreen` (Plan tab), open `AddItemMenuSheet` (state-driven, `isOpen =
addItemMenuMealType !== null`).
2. `adb shell am start -a android.intent.action.VIEW -d "ocrecipes://recipe/<id>"
com.ocrecipes.app` — pushes `FeaturedRecipeDetail` on top, blurring `MealPlanHomeScreen`. The
   sheet stays visually presented (gorhom portals render at a fixed host).
3. Hardware back once — `FeaturedRecipeDetail` pops correctly, back on `MealPlanHomeScreen`, sheet
   still open (AC2's PASS condition).
4. Hardware back again — **sheet does not dismiss.** Repeated once more — still no dismiss.
5. Tap the sheet's backdrop — dismisses instantly (sheet and touch handling are otherwise
   responsive).
6. Open a _new_ `AddItemMenuSheet` (fresh `present()` call) — single hardware back press dismisses
   it normally.

## Acceptance Criteria

- [x] Reproduce the sequence above (or a `renderHook`/fake-timer unit-test equivalent that
      simulates blur → refocus → two `BackHandler` fires) and confirm the stuck-listener behavior.
      Reproduced via a `renderHook` unit test (no device/emulator access in this session) —
      see Updates below.
- [x] Identify why the listener stops consuming back after the round-trip — **partially**: ruled
      out `isFocusedRef` (already correctly settles true→false→true; covered by a pre-existing
      passing test) and a competing/leaked JS `BackHandler` listener (only one JS listener exists
      on this path — React Navigation's own is registered once at boot). Root cause narrowed to
      `isOpenRef` desync: it is only ever set true by `isOpen` _transitioning_ to true, and only
      ever cleared by `onSheetChange(-1)` — a spurious `onSheetChange(-1)` while `isOpen` itself
      never changes leaves it permanently stuck false with no recovery path. The exact native
      trigger of the spurious event was **not** conclusively pinned (candidates researched:
      `FeaturedRecipeDetail`'s `presentation: "modal"` + `gestureEnabled` config and RN 0.81.5's
      AndroidX back-dispatcher migration) — left as a known gap; the fix is defensive rather than
      root-cause-eliminating.
- [x] Fix `useSheetBackHandler.ts` (or the relevant navigator wiring) so hardware back reliably
      dismisses an already-open sheet after any blur/refocus cycle, not just on first open.
- [x] Add a unit test covering blur → refocus → back-dismiss to prevent regression.

## Implementation Notes

- `client/hooks/useSheetBackHandler.ts` — the `isFocusedRef` mirror effect and the mount-time
  `BackHandler.addEventListener` are the two places to instrument/inspect first.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — 4 sheets each register their own listener;
  the declaration-order comment there (LIFO registration) is relevant if a leaked listener from
  elsewhere is the cause.
- Not urgent for users: a second back press doesn't happen automatically, but a tap always works,
  so there's no dead end — hence P3/low despite touching back-button correctness.

## Dependencies

- None.

## Risks

- If the root cause is a React Navigation back-handler cleanup ordering issue (not something local
  to this hook), the fix may need to live at the navigator/App.tsx level instead of purely in
  `useSheetBackHandler.ts` — budget for that possibility.

## Updates

### 2026-07-12

- Filed from on-device findings while verifying PR #555's close-animation and focus-scoping fixes
  (`todos/archive/P3-2026-07-09-usesheetbackhandler-ondevice-verification.md`).

### 2026-07-13

- No Android device/emulator access in this execution session — reproduced via a `renderHook` unit
  test instead (the AC's explicit fallback), rather than on-device.
- Ruled out `isFocusedRef` desync and a competing/leaked JS `BackHandler` listener as root causes
  (research: only one JS `hardwareBackPress` listener exists on the affected path besides our own
  — React Navigation's own, registered once at app boot).
- Narrowed root cause to `isOpenRef`'s write-true-on-`isOpen`-transition-only, write-false-on-
  `onSheetChange(-1)`-only asymmetry: a spurious `onSheetChange(-1)` while the state-driven `isOpen`
  boolean itself never changes leaves `isOpenRef` permanently stuck false, since nothing re-triggers
  the opening effect. The precise native trigger of the spurious event was not conclusively
  confirmed (see the AC checklist above for the researched candidates) — this is a defensive fix,
  not a root-cause elimination.
- Fixed `client/hooks/useSheetBackHandler.ts`: added `stateIsOpenRef`, a live unconditional mirror
  of the `isOpen` prop; the hardware-back handler now treats the sheet as open if either
  `isOpenRef.current` or `stateIsOpenRef.current === true`. Scoped to state-driven hosts only —
  imperative hosts (no `isOpen` passed) have no authoritative fallback source and remain exposed to
  the same class of issue (documented as a known gap in the hook's JSDoc).
- Added two regression tests to `client/hooks/__tests__/useSheetBackHandler.test.ts`: (1) the
  repro — spurious `onSheetChange(-1)` while `isOpen` stays true through a blur/refocus round-trip,
  asserting a further back press still dismisses; (2) the symmetric negative case — a genuine close
  (`isOpen` flips false for real, confirmed by `onSheetChange(-1)`) still lets a post-refocus back
  press fall through, so the fix can't make a really-closed sheet "sticky."
- Verified via `code-reviewer` + `mobile-reviewer`: no CRITICAL/WARNING findings block the fix
  (one WARNING about a forward reference to this file's own archive path was pre-resolved by the
  archive step below; SUGGESTIONs addressed inline where in-scope and consistent with the existing
  `hooks.md` async-callback-ref convention, otherwise left as-is per reviewer's own "not blocking"
  assessment).
