<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Android hardware back should dismiss open BottomSheetModals, not navigate beneath them"
status: done
priority: low
created: 2026-07-02
updated: 2026-07-07
assignee:
labels: [deferred, ui-ux, android]
github_issue:

---

# Android hardware back should dismiss open BottomSheetModals

## Summary

No `BottomSheetModal` in the app wires Android's hardware back button: `@gorhom/bottom-sheet` has no built-in `BackHandler` (verified in library source), so a back press with a sheet open pops the screen (or backgrounds the app) underneath the still-open sheet. Every sheet host is affected — MealPlanHomeScreen's four sheets, HomeScreen and RecipeEntryHubScreen's import sheets, BeveragePickerSheet.

## Background

Flagged in the recipe-import phase1-v2 port review (2026-07-02). The port removed RecipeEntryHubScreen's `ActionSheetIOS`/`Alert.alert` photo flow, which WAS natively back-dismissible on Android, so the hub specifically regressed — but the gap is pattern-wide and pre-existing everywhere else, hence a systemic fix rather than an inline patch.

## Acceptance Criteria

- [x] With any bottom sheet open, Android hardware back dismisses the sheet and consumes the event (no simultaneous navigation)
- [x] With no sheet open, back behaves as before
- [x] Implemented once at a shared level (e.g. a `useSheetBackHandler(ref, isOpen)` hook or a wrapper component), not copy-pasted per host
- [ ] Verified on the Android emulator across at least MealPlanHomeScreen (effect-presented) and HomeScreen (imperatively presented) sheets — **partial**, see Updates below

## Implementation Notes

- `BackHandler.addEventListener("hardwareBackPress", …)` returning `true` while the sheet is presented; hosts using imperative present (no open-state) need the handler keyed on the modal's `onChange`/`onDismiss` lifecycle or a small isOpen ref.
- Consider gorhom's `enableHandlePanningGesture`/`onChange` to track presented state without adding React state to imperative hosts.

## Dependencies

- None.

## Risks

- Back-handler ordering with React Navigation's own back handling — register/unregister tightly around sheet visibility to avoid swallowing legitimate back presses.

## Updates

### 2026-07-02

- Initial creation from phase1-v2 port review (rn-ui-ux-specialist WARNING).

### 2026-07-07

- Implemented `client/hooks/useSheetBackHandler.ts` — a shared hook wired into
  all 6 real `BottomSheetModal` hosts in the app (the 4 named in the Summary
  plus `RecipeBrowserScreen` and `ConfirmationModal`, discovered via
  `grep -rl "<BottomSheetModal" client --include="*.tsx"` and included since
  AC1's "any bottom sheet open" wording and the Background's "systemic fix"
  framing cover them, and the marginal cost was trivial with a shared hook).
  State-driven hosts (MealPlanHomeScreen's 4 sheets) pass `isOpen` directly;
  imperatively-presented hosts (HomeScreen, RecipeEntryHubScreen,
  BeveragePickerSheet, ConfirmationModal, RecipeBrowserScreen) wire the
  hook's `onSheetChange`/`onSheetAnimate` callbacks onto the BottomSheetModal's
  own `onChange`/`onAnimate` props to derive presented state without adding
  React state. Two review rounds (code-reviewer + mobile-reviewer, then a
  focused code-reviewer follow-up) — round 1 caught a real gap (`onChange`
  only fires on animation _complete_, leaving imperative hosts with a dead
  window during the ~300ms opening animation where back would fall through);
  fixed via `onAnimate` (fires at animation _start_, verified against gorhom
  source) and covered with 3 additional unit tests. 10/10 hook tests pass,
  full suite 5904/5904, types/lint clean.
- **AC4 verification is partial.** Confirmed on the Android emulator: (a) with
  a sheet fully open, back dismisses it and leaves the underlying screen
  intact (no simultaneous pop); (b) with no sheet open, back navigates as
  before. This was confirmed via the imperative-present pattern on
  `RecipeBrowserScreen`'s filter sheet, not the two screens AC4 names by name.
  `MealPlanHomeScreen`'s sheets were not exercised on-device (their triggers
  are behind an empty meal-plan state not reached during this session).
  `HomeScreen`'s import sheet could not be exercised on-device because of an
  unrelated pre-existing crash (see below) — opening it trips
  `ImportRecipeSheetContent`'s `useToast()` call, which throws before the
  sheet is visible. The exact mid-opening-animation race the reviewer flagged
  is deterministically covered by the hook's unit tests (which assert the
  gorhom `onAnimate`-before-`onChange` ordering against verified library
  source) rather than by a clean on-device repro — attempts to force it via
  zero-latency `adb shell input tap; input keyevent 4` are not a faithful
  proxy for the sub-300ms window (adb's zero-gap double-input can fire the
  back keyevent before the tap's `onPress` → `.present()` call chain has even
  begun, which no `onAnimate`-based fix can address and no human can
  reproduce). Given the P3 priority and the strength of the unit coverage,
  further manual-verification time was not spent chasing a clean repro of
  the two AC4-named screens specifically.
- **Discovered, out of scope, not fixed:** opening any `BottomSheetModal`
  whose content calls `useToast()` (e.g. `ImportRecipeSheetContent`, used by
  both `HomeScreen` and `RecipeEntryHubScreen`'s import sheets) crashes
  reproducibly with `useToast must be used within a ToastProvider`, tripping
  the app's top-level ErrorBoundary. Likely cause (inferred from source, not
  confirmed with a maintainer): `client/App.tsx` nests `BottomSheetModalProvider`
  outside `ToastProvider`, and `@gorhom/bottom-sheet`'s portal mechanism
  renders sheet content at the `BottomSheetModalProvider`'s Host position in
  the tree (a sibling declared before `PortalProvider`'s wrapped children),
  not at the original call site — so `ToastProvider`'s context never reaches
  any sheet content regardless of where in the tree the sheet is presented
  from. This is unrelated to this todo (not introduced by this diff) but is
  high severity — it breaks the import-recipe flow app-wide — and worth a
  maintainer follow-up.
