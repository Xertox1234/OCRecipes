---
title: "Consolidating N sheets onto one state union: a shared onDismiss/close handler must be kind-guarded, or a late-firing dismiss clobbers a just-opened sibling"
track: bug
category: logic-errors
tags: [react-native, hooks, client-state, bottom-sheet, accessibility]
module: client
applies_to: ["client/**/*.tsx", "client/hooks/useSheetBackHandler.ts"]
symptoms: ["a menu -> destination-sheet handoff (close one BottomSheetModal, then InteractionManager.runAfterInteractions opens a different one) intermittently leaves the destination sheet's Android back-handler or focus-trap pointing at nothing, as if it silently closed itself right after opening", "consolidating several `useState<T | null>` atoms into one `activeSheet: {kind, T} | null` union appears correct in every manual test but breaks only under a same-screen handoff between two of the sheets"]
created: 2026-09-25
severity: medium
---

# Consolidating N sheets onto one state union: a shared close handler must be kind-guarded

## Problem

When N independently-toggled `BottomSheetModal` state atoms (`const [fooOpen, setFooOpen] = useState<T|null>(null)` × N) are collapsed into one `activeSheet: { kind, ... } | null` union, each sheet's own `onDismiss` handler is naturally rewritten from a bare "clear my atom" (`setFooOpen(null)`) to a bare "clear the shared state" (`setActiveSheet(null)`). That naive rewrite is a race: `@gorhom/bottom-sheet`'s `onDismiss` fires when a sheet's **close animation completes**, which is not guaranteed to run strictly before a same-screen handoff's `InteractionManager.runAfterInteractions` callback opens a *different* sheet. If the closing sheet's `onDismiss` fires late — after the destination sheet has already set `activeSheet` to its own kind — an unguarded `setActiveSheet(null)` clobbers the destination's just-opened state, even though nothing the user did asked for it to close.

This is invisible in the OLD per-atom architecture because each sheet's own `onDismiss` only ever clears **its own** atom (`setFooOpen(null)` cannot accidentally clear `barOpen`) — the hazard is created BY the consolidation, not present before it.

## Symptoms

See frontmatter. Concretely: a menu -> quickAdd (or -> simpleEntry / -> importRecipe) handoff where the destination sheet's Android hardware-back handling or TalkBack/VoiceOver focus trap behaves as if no sheet were open, immediately after the handoff completed.

## Root Cause

`BottomSheetModal.onDismiss` and the InteractionManager-scheduled destination-open are two independently-timed callbacks with no ordering guarantee between them. A shared `onDismiss={() => setActiveSheet(null)}` wired to **every** sheet instance (since they all now read from the same union) has no way to tell "I am dismissing because the destination just took over" from "the user is genuinely done with this sheet" — both call the same setter with the same argument.

## Solution

Guard every close/dismiss path with a check that the union is still pointing at the closing sheet's own kind before clearing it:

```tsx
type SheetKind = "addItemMenu" | "importRecipe" | "quickAdd" | "simpleEntry";
type ActiveSheet = { kind: SheetKind; mealType: MealType } | null;

const closeSheet = useCallback((kind: SheetKind) => {
  setActiveSheet((prev) => (prev?.kind === kind ? null : prev));
}, []);

// Every dismiss/close call site uses the SAME guarded helper:
const handleAddItemMenuDismiss = useCallback(() => closeSheet("addItemMenu"), [closeSheet]);
// ...and every "close A, then (after InteractionManager) open B" handoff:
const handleChooseRecipe = useCallback(() => {
  const mt = addItemMenuMealType;
  closeSheet("addItemMenu");
  InteractionManager.runAfterInteractions(() => {
    if (mt !== null) openSheet("quickAdd", mt);
  });
}, [addItemMenuMealType, closeSheet, openSheet]);
```

`prev?.kind === kind ? null : prev` is a no-op when the union has already moved on to a different kind (the destination is left untouched), and correctly clears when the union still names the closing sheet (the ordinary single-sheet-closes case). This must be applied to **every** call site that used to do a bare `setFooOpen(null)` — not just the sheet's own `onDismiss` prop, but also every inline `setFooOpen(null)` inside a handoff handler, and any navigate-then-close handler.

### The same shared-callback hazard also applies to the back-handler's onChange/onAnimate

If the N sheets also share ONE `useSheetBackHandler(...)` call (rather than N independent instances), its returned `onSheetChange`/`onSheetAnimate` are likewise wired to **every** `<BottomSheetModal>`'s `onChange`/`onAnimate` — so any one instance firing `onChange(-1)` (a late close from the just-abandoned sheet, or the spurious blur/refocus duplicate event `useSheetBackHandler`'s own JSDoc documents) clears the ONE shared `isOpenRef` even while a *different* sheet is genuinely still open. Correctness in that window depends entirely on `useSheetBackHandler`'s `stateIsOpenRef` fallback (mirrored from the caller's own `isOpen` boolean — here, `activeSheet !== null`), which the hook originally added for an unrelated single-sheet blur/refocus bug and is now silently load-bearing for the multi-sheet case too. Do not weaken or remove that fallback without checking every multi-sheet-union call site.

## Prevention

- When collapsing N independent sheet/modal state atoms into one union, audit **every** call site that used to write `null` to an atom (dismiss handlers, handoff handlers, navigate-then-close handlers) and route them all through one `closeSheet(kind)` helper guarded on `prev?.kind === kind`.
- Write a regression test for the specific handoff: open sheet A, trigger the handoff to sheet B, then fire A's `onDismiss` (simulating a late close-animation completion) — assert B is still the active sheet (its focus trap / back-dismiss target unaffected).
- If the sheets also share one back-handler hook instance, note in a comment that its shared `onChange`/`onAnimate` now depend on the hook's own `isOpen`-derived fallback for correctness, not just the naive per-call `isOpenRef`.
- The shared `test/mocks/react-native.ts` RN mock does not export `InteractionManager` at all (it is a hand-written mock, not a re-export of the real package) — any test that reaches a menu -> destination-sheet handoff throws `undefined is not a function` on `InteractionManager.runAfterInteractions` until the test file locally mocks it (queue the callback instead of running it synchronously, so ordering can be asserted before flushing).

## Related Files

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — `closeSheet`/`openSheet` helpers, the unified `activeSheet` state, and the shared `useSheetBackHandler` call.
- `client/hooks/useSheetBackHandler.ts` — the `stateIsOpenRef` fallback this pattern now depends on (not modified by this fix, but load-bearing for it).
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — the local `react-native` mock's `InteractionManager` override and the "a late onDismiss from the just-closed add-item-menu does not clobber the newly-opened quick-add sheet" regression test.

## See Also

- [@gorhom/bottom-sheet collapses its subtree into one a11y leaf on iOS new-arch](gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md) — the other multi-sheet MealPlanHomeScreen hazard, orthogonal to this one
- [gorhom onChange fires on animation complete, not start](gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md) — the underlying close-animation-timing mechanism this hazard rides on
