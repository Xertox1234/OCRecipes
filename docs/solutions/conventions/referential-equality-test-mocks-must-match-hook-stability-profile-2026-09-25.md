---
title: "A referential-equality test's mocks must match each real hook's re-render stability profile"
track: knowledge
category: conventions
tags: [testing, react, hooks, mocking, performance, react-native]
module: client
applies_to: ["client/**/__tests__/*.test.tsx"]
created: 2026-09-25
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

## Smell patterns

- A referential-equality assertion (`expect(x).toBe(y)`) fails even though the code path you
  changed looks correct, and the failure doesn't reproduce when you trace the dependency chain
  from the production component by hand.
- A mock factory shaped `() => ({ ... })` used in a test that asserts identity stability of
  anything downstream of it.
- An identity-stability test with no assertion that the triggering state change actually landed.

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

## See Also

- [Use useRef for synchronous checks in callbacks (dual tracking)](useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
- [Use extraData (not useCallback deps) for FlatList re-renders driven by ref-based state](flatlist-extradata-for-ref-based-state-2026-06-03.md)
