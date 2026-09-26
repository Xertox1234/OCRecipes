---
title: "A referential-equality test's mocks must match each real hook's re-render stability profile"
track: knowledge
category: conventions
tags: [testing, react, hooks, mocking, performance, react-native]
module: client
applies_to: ["client/**/__tests__/*.test.tsx"]
created: 2026-09-25
last_updated: 2026-09-25
---

# A referential-equality test's mocks must match each real hook's re-render stability profile

## Rule

When a test asserts referential equality of a value derived from `useCallback`/`useMemo` (e.g. a
stable `renderItem` prop passed to `FlatList`, a memoized handler), every mocked hook that value
transitively depends on must reproduce that hook's REAL re-render stability profile — not just
"return something plausible." A mock that is MORE stable than production masks a real bug; a mock
that is LESS stable than production produces a false failure unrelated to the code under test.

Before writing such an assertion, classify each dependency:

- **Genuinely stable across re-renders in production** (e.g. `useNavigation()` from
  `@react-navigation/native` returns the SAME memoized object every render; a
  `useCallback`-wrapped hook return like `useTTS()`'s `speak`/`stop`) → the mock must return one
  hoisted/module-level reference (`vi.hoisted(() => ({ ... }))`), never a fresh object/function
  literal constructed inside the mock factory body — a factory like
  `() => ({ navigate: vi.fn() })` allocates a NEW object on every call, which is invisible until
  something downstream keys a `useCallback` dependency on the whole object.
- **Genuinely UNSTABLE across re-renders in production** (e.g. a bare `useMutation(...)` return —
  TanStack Query's `useMutation` spreads `{ ...result, mutate, mutateAsync: result.mutate }` into
  a brand-new wrapper object on every render, even though `mutate`/`mutateAsync` themselves are
  `useCallback`-stable underneath) → the mock must reproduce that instability (fresh wrapper
  object per call) while keeping only the genuinely-stable inner piece (the function reference)
  fixed. Faking full stability here would let a real bug — a component depending on the whole
  mutation object instead of destructuring `mutateAsync` — pass the test by accident.
- **TanStack Query `data`** is structurally shared by default (`structuralSharing: true`) — it
  keeps the SAME array/object reference across re-renders when the underlying query result
  hasn't changed. A mock returning a fresh `[]`/`{}` literal per call breaks any `useMemo` keyed
  on it, for a reason unrelated to the SUT.

Also pair the identity assertion with a **positive control/denominator**: proof the state change
that should have triggered a re-render actually did (e.g. the component's own visible output
changed). Without one, a component that silently never re-renders (a broken wiring seam) trivially
keeps every prop "stable" and the test passes for the wrong reason.

**The denominator inverts when the capture point sits INSIDE a `React.memo`'d parent.** A plain
`FlatList`/`SectionList` capture always gets a fresh props object on every parent render (JSX
`createElement` allocates a new object regardless of prop values), so the correct denominator is
`expect(secondCapture).not.toBe(firstCapture)` — proof the parent re-rendered at all — paired with
`expect(secondCapture.renderItem).toBe(firstCapture.renderItem)` for the actual fix. But when the
capture target (e.g. a list component rendered *inside* a memoized row like `MealSlotSection`) is
itself gated by `React.memo`, a CORRECT fix means the memo bails and the wrapped component **never
re-renders at all** — its captured props object stays the exact SAME reference, not merely its
individual fields. Asserting `not.toBe` here would be backwards: it passes on the UNFIXED code
(where the memo fails to bail and the child re-renders with new field values inside a new object)
and would need to be rewritten to `toBe` once the fix lands, or it silently tests nothing. Get the
denominator from an INDEPENDENT, visible signal instead — e.g. a sibling row's own expand/collapse
state, or any DOM output that changes for a reason unrelated to the props under test — never from
the capture object itself when the capture sits behind a memo boundary. Confirm memo eligibility
first: EVERY prop the memoized parent receives (not only the ones under test) must be stable across
the trigger, including pre-existing `useMemo`d array/derived-value props unrelated to this specific
fix.

**Reading a captured `renderItem`'s nested props without rendering.** When the value passed to a
captured list prop is itself a callback that constructs and returns a child element (rather than
the list capturing the child's props directly), invoke the captured function as a plain JS call —
`const element = capturedProps.renderItem(item)` — and read `element.props`/`element.props.children.props`
directly. This works because such a `renderItem` closure typically calls no hooks itself (it just
builds JSX from already-resolved closure variables), so calling it outside a render pass is safe,
and it exposes the exact prop values (e.g. an `onRemove`/`onConfirm` handler) that a real render
pass would have handed to the nested element — without needing to mock every intermediate
component in the chain just to reach a leaf's props.

## Smell patterns

- A referential-equality assertion (`expect(x).toBe(y)`) fails even though the code path you
  changed looks correct, and the failure doesn't reproduce when you trace the dependency chain
  from the production component by hand.
- A mock factory shaped `() => ({ ... })` used in a test that asserts identity stability of
  anything downstream of it.
- An identity-stability test with no assertion that the triggering state change actually landed.
- A `.not.toBe(...)` denominator on a capture point that sits inside a `React.memo`'d component —
  once the fix under test lands, that memo should bail and the assertion should flip to `.toBe(...)`.

## Why

Writing one test that asserts a `FlatList` `renderItem` prop stays referentially equal across a
keystroke-driven re-render surfaced three false negatives and one near-false-positive in the same
file:

1. `useNavigation: () => ({ navigate: vi.fn() })` — a new object per call — broke
   `handleBlockAction`'s `useCallback` deps (which include the whole `navigation` object), even
   after the actual production bug was already fixed.
2. `useChatMessages: () => ({ data: [] })` — a new empty-array literal per call — broke a
   `useMemo` keyed on `[messages]` two hops upstream of `renderItem`.
3. `useTTS`/`useCoachStream` mocks returning a fresh `vi.fn()` per call — same class of false
   negative, for functions that are genuinely `useCallback`-stable in the real hooks.
4. Conversely, mocking `useDeleteChatMessageForRetry` to return one stable object wholesale would
   have hidden a REAL bug: production code at the time depended on the WHOLE (genuinely-unstable)
   mutation object rather than destructuring its stable `mutateAsync`, which the test needed to
   catch.

A code review on the same diff separately caught that the test, as first written, had no
denominator: deleting both `fireEvent.change` calls left it green, because a component that never
re-renders trivially keeps every prop "stable."

## Examples

```typescript
// Bad — a fresh object per call defeats a referential-equality assertion
// even when the code under test is already correct.
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

// Good — one hoisted object, matching react-navigation's real stability.
const stable = vi.hoisted(() => ({ navigation: { navigate: vi.fn() } }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => stable.navigation,
}));

// Good — faithfully UNSTABLE wrapper, STABLE inner function (real useMutation shape).
const stable = vi.hoisted(() => ({ deleteMutateAsync: vi.fn() }));
vi.mock("@/hooks/useChat", () => ({
  useDeleteChatMessageForRetry: () => ({ mutateAsync: stable.deleteMutateAsync }),
}));
```

## Exceptions

When a test does not assert referential equality (the large majority of tests), mock factories
returning fresh `vi.fn()`/object literals per call are fine and simpler — this rule applies only
to identity-stability assertions.

## Related Files

- `client/components/coach/__tests__/CoachChat.render-item-stability.test.tsx` — the test that
  surfaced this
- `client/components/coach/CoachChat.tsx` — the component under test
- `client/screens/meal-plan/__tests__/RecipeBrowserScreen.params.test.tsx` — the sibling
  `SectionList`-capture pattern this test's capture technique is based on
- `client/screens/meal-plan/__tests__/RecipeBrowserScreen.render-item-stability.test.tsx` — same
  `not.toBe`-then-`toBe` denominator pattern, applied to a `useMutation()` destructuring fix
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.render-item-stability.test.tsx` — the
  inverted (`toBe`-only) denominator case: the capture target (`DraggableList`) sits inside a
  `React.memo`'d parent (`MealSlotSection`), and the plain-function `renderItem(item)` invocation
  technique for reading a nested `MealSlotItem` element's props without rendering
- `client/screens/__tests__/HomeScreen.render-item-stability.test.tsx` — a third variant: multiple
  unmemoized capture targets (`DailySummaryHeader`/`RecentActionsRow`/`RefreshControl`), so
  field-level identity assertions are correct there, with the denominator coming from an
  independent accessibility-attribute signal (`importantForAccessibility`) rather than the
  captures themselves

## See Also

- [Use useRef for synchronous checks in callbacks (dual tracking)](useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
- [Use extraData (not useCallback deps) for FlatList re-renders driven by ref-based state](flatlist-extradata-for-ref-based-state-2026-06-03.md)
