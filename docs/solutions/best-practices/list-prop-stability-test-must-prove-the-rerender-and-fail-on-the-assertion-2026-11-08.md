---
title: "A list-prop stability test must prove the re-render happened and must go red on its assertion, not on a broken mock"
track: knowledge
category: best-practices
module: client
tags: [testing, performance, react-native, react-compiler]
applies_to: ["client/**/__tests__/*.test.tsx"]
created: 2026-11-08
---

# A list-prop stability test must prove the re-render and fail on the assertion

## Rule

When a test asserts that a prop passed to a `FlatList`/`SectionList`/`BottomSheetFlatList`
keeps its identity (or carries virtualization props), it must:

1. **Prove a re-render happened** before comparing — capture the props object twice and
   assert `second !== first`. A `React.memo` component re-rendered with identical props
   does not re-render at all, so `rerender(<Same {...props} />)` compares a props object
   with itself and passes for any code. Drive the re-render through the component's own
   state instead (type in its search field).
2. **Go red on the assertion it is about.** Run it against the unfixed code (copy the
   `main` version over the file, run, restore) and read the failure: it must be the
   identity/prop assertion, not a render crash.
3. **Use mocks that don't manufacture instability.** `useToast`/`useHaptics` return
   memoized values in production; a mock returning a fresh object each call makes the
   callback unstable for a reason the fix can't touch. Hoist one stable object.

## Why

Three of the 2026-11-08 performance audit's red-first tests were misleading on the first
run: QuickAddSheet's `rerender` "passed" its own control because the sheet is `React.memo`;
the GroceryListScreen test failed only because `{ ...actual, SectionList }` over the
shared `react-native` mock drops `RefreshControl` (not an own enumerable export), so the
screen threw before the assertion; and the existing QuickAddSheet test mocks
`useToast`/`useHaptics` with fresh objects, which would hide the M2 fix.

## Examples

- `client/screens/meal-plan/__tests__/RecipeBrowserScreen.render-item-stability.test.tsx`
  — `it.each` over every SectionList prop (SectionList is a PureComponent: in a compiler
  bailout file, `sections`, section renderers, `onEndReached`, `ListFooterComponent` and
  `contentContainerStyle` all need stable identities, not only `renderItem`).
- `client/components/meal-plan/__tests__/QuickAddSheet.render-item-stability.test.tsx` —
  keystroke-driven re-render of a `React.memo` sheet, stable hook mocks.
- `client/screens/meal-plan/__tests__/GroceryListScreen.list-props.test.tsx` —
  `RefreshControl: () => null` added to the `react-native` override.

## Related Files

- `test/mocks/react-native.ts` — the shared mock whose non-enumerable exports a spread drops
- `scripts/react-compiler-bailout-baseline.json` — which files need manual memoization

## See Also

- `docs/solutions/best-practices/react-compiler-memoization-audits-2026-06-10.md`
- `docs/solutions/logic-errors/remove-clipped-subviews-hides-offscreen-cards-from-screen-readers-2026-10-23.md` — why the list tests assert `removeClippedSubviews === false`
