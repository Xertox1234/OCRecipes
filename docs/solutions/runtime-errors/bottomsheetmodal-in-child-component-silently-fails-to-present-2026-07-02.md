---
title: 'A BottomSheetModal presented from a useEffect in a separate-file child component silently fails to present — no error, no callback, no visual change'
track: bug
category: runtime-errors
module: client
severity: critical
tags: [gorhom-bottom-sheet, bottom-sheet, react-native, metro, module-boundary, meal-plan]
symptoms: ['Tapping a button that should open a BottomSheetModal does nothing — no sheet, no error, no console output beyond the effect firing and .present() returning.', The modal's onChange/onAnimate callbacks never fire after .present() is called., 'The same BottomSheetModal JSX, moved directly into the screen component, works immediately.', Reproduces identically on a clean Metro cache and on a real (non-Metro) build — not a dev-tooling or HMR artifact.]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-07-02'
last_updated: '2026-07-02'
---

# A BottomSheetModal presented from a useEffect in a separate-file child component silently fails to present

## Problem

`@gorhom/bottom-sheet`'s `<BottomSheetModal>`, when declared in a component file separate from the screen that owns its trigger state, and presented via a `useEffect` that reactively calls `.present()`/`.dismiss()` in response to that state, is a silent no-op: the call returns without throwing, but the library's internal `onChange`/`onAnimate` callbacks never fire and nothing appears on screen.

This affected all four meal-plan "add item" sheets (`AddItemMenuSheet`, `ImportRecipeSheet`, `QuickAddSheet`, `SimpleEntrySheet`) — each was a separate component that owned its own `BottomSheetModal`, presented via an effect watching a `mealType` prop, and none of them ever presented, on either a Metro dev build or a real device/release-style build.

**Revision note (2026-07-02, same day):** the original version of this doc claimed the *only* variable that mattered was file location — "declare the modal directly in the screen." That rule is **false as stated**. This codebase already has a working counter-example (`client/hooks/useBeverageSheet.ts` → `client/components/BeveragePickerSheet.tsx`, live in production via `PhotoAnalysisScreen.tsx`) that declares its `BottomSheetModal` in a separate file and presents correctly. A follow-up bounded experiment (below) reproduced that working pattern from scratch and confirmed it. The corrected root cause is narrower — see "Root Cause."

## Symptoms

- Tapping the trigger button produces zero visible change — no sheet, no backdrop, no error.
- `console.log` instrumentation confirms the full chain runs correctly: the trigger state changes, the `useEffect` fires, `sheetRef.current` is truthy, `.present()` is called and returns.
- `onChange`/`onAnimate` callbacks added to the `BottomSheetModal` never fire — the library's internal state machine never registers a transition.
- Reproduces on a completely fresh Metro cache (`expo start --clear`) — rules out Fast Refresh/HMR staleness.
- The identical `BottomSheetModal` JSX, moved inline into the screen component (same props, same content, same effect-driven trigger), presents correctly on the very next tap.

## Root Cause

Root cause is **not fully understood, and the single operative variable is not isolated.** What is established empirically, from three data points gathered across two sessions:

| BottomSheetModal declared in | `.present()` triggered by | Result |
|---|---|---|
| Separate file from state owner | `useEffect` watching state, ref passed via `forwardRef` from the child | **BROKEN** — all four original meal-plan sheets, extensively reproduced with a bare-minimum control (zero extra imports beyond React/RN/`@gorhom/bottom-sheet`) in multiple file locations |
| Same file as state owner (the screen) | `useEffect` watching state | **WORKS** — this PR's shipped fix, verified live in the simulator |
| Separate file from state owner | The full `useBeverageSheet` shape: hook-owned ref threaded in as a plain prop, a `useMemo`-stabilized wrapper component, a `setRevision` force-render, and a purely imperative `open()` call from `onPress` with no `useEffect` anywhere | **WORKS** — both the pre-existing, production-wired `useBeverageSheet`/`BeveragePickerSheet` pattern, and a from-scratch reproduction of that exact shape (`useDebugImperativeSheet` control, tested and reverted this session) |
| Same file as state owner (**HomeScreen**) | `useEffect` watching state | **BROKEN** — recipe-import phase1-v2 port (PR #485): effect fires, `sheetRef.current` non-null, `.present()` called and returns, nothing renders. Same shape that works on MealPlanHomeScreen (row 2) fails on HomeScreen — so "same-file + effect-driven" is screen-dependent, NOT generally sufficient |
| Same file as trigger (HomeScreen, RecipeEntryHubScreen) | Bare imperative `.present()` inside the `onPress` handler — screen-owned ref, `useMemo`'d children, **no** effect, **no** `setRevision` force-render, **no** hook wrapper | **WORKS** — verified live by tap on both screens, including on a cold-loaded committed bundle (PR #485) |

Row 3 disproves "file location alone is the cause" — a separate-file modal presents fine here. But row 3 changes **four things at once** relative to row 1 (no effect, a `useMemo` wrapper, a hook-owned ref-as-prop instead of `forwardRef`, and a force-render before `.present()`), so it only proves *that whole shape* works — it does **not** isolate which of those four changes is load-bearing.

**Rows 4–5 (2026-07-02, PR #485) sharpen this considerably.** Row 4 falsifies "same-file + effect-driven is sufficient" — the exact shape that works on MealPlanHomeScreen silently fails on HomeScreen. Row 5 shows the *minimal* imperative change fixes it: same screen, same ref, same children — only the trigger moved from an effect into the press handler, with none of `useBeverageSheet`'s other ingredients (no force-render, no `useMemo` wrapper, no hook indirection). Across all five rows the single variable that separates every WORKS from every BROKEN is now **effect-driven vs. handler-driven `.present()`** — with the caveat that the effect shape does still work on MealPlanHomeScreen specifically, so an unidentified screen-level factor (render timing under the scroll-linked header? tab-navigator context?) determines whether the effect shape survives. Ruled out by direct testing (all sessions):

- **Not** `enableDynamicSizing`, `React.memo`, `React.forwardRef`, or any hook the component called (`useTheme`, `useHaptics`) — a bare-minimum component with *zero* extra imports reproduced the failure.
- **Not** a duplicate/nested `@gorhom/bottom-sheet` module instance (single symlinked `node_modules`; no duplicate package possible).
- **Not** directory-specific Metro/babel config — a bare sheet placed as a sibling file to the screen itself failed identically to one in `client/components/meal-plan/`.
- **Not** Metro/HMR cache staleness — reproduces on a fully cleared cache.

**Superseded finding, flagged rather than silently dropped:** the original version of this doc additionally claimed to have ruled out imperative triggering, citing a test where "synchronous `.present()` inside `onPress`, via an imperative handle, failed identically to the effect-driven version." That test added an imperative trigger *alongside* the original component's existing `useEffect`, rather than replacing it — so it was not a clean isolation, and its failure is more likely explained by the still-running effect (e.g. racing or immediately re-dismissing) than by the imperative call itself. The clean, effect-free reproduction done in the follow-up (row 3 above) contradicts it. Treat the "imperative doesn't help" claim as retracted.

One already-working sheet in this codebase that follows the "same-file, effect-driven" pattern (`RecipeBrowserScreen`'s advanced-filters sheet) was the original control that confirmed the differential was real, rather than every `BottomSheetModal` in the app being broken.

## Solution

Two independently-sufficient fixes are known; this PR uses the first.

### Fix used in this PR: move the modal into the screen (same-file, effect-driven)

Split each sheet into two pieces:

1. **A content-only component** (kept in its own file for readability) that renders everything *inside* the sheet — no `BottomSheetModal`, no ref, no present/dismiss effect. It receives its trigger state (e.g. `mealType`) as a prop purely for display/business logic, not for controlling presentation.
2. **The screen component** owns the `BottomSheetModal` ref, the `useEffect` that calls `.present()`/`.dismiss()` based on the trigger state, and the `<BottomSheetModal>` JSX itself — with the content component rendered as its children.

```tsx
// AddItemMenuSheet.tsx — content only, no BottomSheetModal
export const ADD_ITEM_MENU_SNAP_POINTS = ["45%"];

export function AddItemMenuSheetContent({ mealType, onChooseRecipe, ... }: Props) {
  // all business logic and inner JSX — nothing modal-related
}
```

```tsx
// MealPlanHomeScreen.tsx — owns the modal
const addItemMenuSheetRef = useRef<BottomSheetModal>(null);

useEffect(() => {
  if (addItemMenuMealType) addItemMenuSheetRef.current?.present();
  else addItemMenuSheetRef.current?.dismiss();
}, [addItemMenuMealType]);

<BottomSheetModal ref={addItemMenuSheetRef} snapPoints={ADD_ITEM_MENU_SNAP_POINTS} ...>
  <AddItemMenuSheetContent mealType={addItemMenuMealType} onChooseRecipe={handleChooseRecipe} ... />
</BottomSheetModal>
```

For sheets whose `BottomSheetModal.onChange` needs to focus an input that lives inside the content component (`QuickAddSheet`, `SimpleEntrySheet`), expose an imperative handle from the content component via `forwardRef`/`useImperativeHandle` (e.g. `focusSearchInput()`), and call it from the screen-owned `onChange`. This kind of cross-boundary imperative call is unaffected by the bug — only the presentation trigger matters.

### Alternative fix (not used here, but proven): copy the `useBeverageSheet` shape wholesale

Keep the `BottomSheetModal` in its own file, but reproduce `useBeverageSheet.ts` / `BeveragePickerSheet.tsx`'s full shape exactly — not just the "no `useEffect`" part of it, since which ingredient of that shape actually matters is not isolated (see Root Cause):

```tsx
// useSomeSheet.ts
export function useSomeSheet() {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [, setRevision] = useState(0); // forces a re-render so a fresh options object is visible before .present()

  const open = useCallback((options) => {
    optionsRef.current = options;
    setRevision((r) => r + 1);
    sheetRef.current?.present();
  }, []);

  const Sheet = useMemo(() => () => <SomeSheetComponent sheetRef={sheetRef} optionsRef={optionsRef} />, []);
  return { open, Sheet };
}
```

This is the pattern already used by `useBeverageSheet.ts` / `BeveragePickerSheet.tsx`, live in production. Prefer this shape when a sheet is genuinely reusable across screens (it was not chosen for the four meal-plan sheets, since their trigger state — `mealType` — is already screen-local and shared with sibling UI). Do not selectively adopt only the imperative-trigger part while dropping the `useMemo` wrapper or the hook-owned-ref-as-prop threading — those variables were never tested independently, so a partial copy is not known to be safe.

## Prevention

- **Default for new sheets: screen-declared modal + bare imperative `.present()` in the press handler** (row 5) — the simplest shape with zero known failures, verified on HomeScreen and RecipeEntryHubScreen (PR #485). Screen owns the ref, children are `useMemo`'d, content's `onDismiss` prop calls `ref.current?.dismiss()`, no presentation effect, no presentation state.
- The effect-driven same-file shape (row 2) works on MealPlanHomeScreen but silently fails on HomeScreen (row 4) — do NOT copy it to new screens; if a sheet must open in response to state (not a tap), tap-verify it on that specific screen before shipping.
- The full `useBeverageSheet` shape remains a verified alternative when a sheet is genuinely reusable across screens.
- Before adding a new sheet, sanity-check by tapping its trigger in the simulator — a silent no-op with no error is the signature of this bug, not a logic mistake in the trigger wiring.
- **HMR look-alike:** after a Fast Refresh, a previously-working sheet can stop presenting (portal registration detaches) — a false reproduction of this bug. Cold-reload the app (terminate + relaunch + reconnect to Metro) before diagnosing; PR #485's review-fix verification hit exactly this.
- The deeper library-internals mechanism is still unknown. The evidence now points at effect-driven presentation as the fragile variable, modulated by an unidentified per-screen factor; if it recurs, the next bounded experiment is effect-vs-handler on the failing screen with everything else held fixed.

## Related Files

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — owns all four `BottomSheetModal`s (the fix used in this PR).
- `client/components/meal-plan/AddItemMenuSheet.tsx`, `ImportRecipeSheet.tsx`, `QuickAddSheet.tsx`, `SimpleEntrySheet.tsx` — content-only components after the fix.
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — the pre-existing sheet that follows the same-file pattern (`filterSheetRef`, inline `BottomSheetModal`, ~line 991).
- `client/hooks/useBeverageSheet.ts` / `client/components/BeveragePickerSheet.tsx` — the pre-existing sheet that follows the separate-file, pure-imperative pattern; live in production via `client/screens/PhotoAnalysisScreen.tsx`.
- `client/screens/HomeScreen.tsx`, `client/screens/meal-plan/RecipeEntryHubScreen.tsx` — the row-5 imperative hosts (PR #485).

## See Also

None yet — first documented occurrence of this failure mode in this codebase.
