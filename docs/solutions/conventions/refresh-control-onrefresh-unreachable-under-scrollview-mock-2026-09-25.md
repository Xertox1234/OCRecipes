---
title: "RefreshControl's onRefresh is unreachable under the shared ScrollView mock unless locally overridden"
track: knowledge
category: conventions
tags: [testing, react-native, mocking]
module: client
applies_to: ["**/__tests__/*.test.tsx"]
created: '2026-09-25'
last_updated: '2026-09-25'
---

# RefreshControl's onRefresh is unreachable under the shared ScrollView mock unless locally overridden

## When this applies

Writing (or updating) a test that needs to trigger a screen's pull-to-refresh handler — any `<ScrollView refreshControl={<RefreshControl onRefresh={...} .../>}>` **or** `<FlatList refreshControl={<RefreshControl .../>}>` under this project's jsdom test harness. The `FlatList` mock has the identical gap (see below) for a different reason.

## Rule

`test/mocks/react-native.ts` (the `react-native` → jsdom alias every RN component test runs through) does not export `RefreshControl` at all, and its `ScrollView` mock (a bare `mockComponent("div", "ScrollView")`) only renders `children` — it never reads or renders `props.refreshControl` as a child, because the real native `ScrollView` owns that render natively and the mock never needed to reproduce it. The practical effect: a `<RefreshControl onRefresh={handleRefresh} />` element passed via `refreshControl={...}` is constructed (`React.createElement(RefreshControl, {...})`) but **never reconciled** — it is just an inert prop value spread onto the DOM node — so the mock component function backing it never executes, and there is no `fireEvent` or DOM query that can reach `onRefresh`.

To test pull-to-refresh, locally override BOTH `RefreshControl` and `ScrollView` in the test file's own `vi.mock("react-native", async (importOriginal) => {...})`, forwarding every other export unchanged via `importOriginal()`:

```typescript
const { refreshControlProps } = vi.hoisted(() => ({
  refreshControlProps: {
    current: null as null | { onRefresh?: () => void | Promise<void> },
  },
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const RefreshControl = (props: { onRefresh?: () => void | Promise<void> }) => {
    refreshControlProps.current = props;
    return null;
  };
  // Not React.forwardRef unless the SUT actually passes a ref to <ScrollView> —
  // check first; forwarding `ref` through React.createElement fights the real
  // react-native type declarations (tsc resolves `typeof import("react-native")`
  // against the real package's types, not this project's Vite alias).
  const ScrollView = ({ children, refreshControl, ...rest }: {
    children?: React.ReactNode;
    refreshControl?: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement(
      actual.ScrollView as React.ComponentType<Record<string, unknown>>,
      rest,
      refreshControl,
      children,
    );
  ScrollView.displayName = "ScrollView";
  return { ...actual, RefreshControl, ScrollView };
});
```

Then in the test: render the screen, assert `refreshControlProps.current?.onRefresh` is a function (a guard against the override silently not firing), and invoke it directly inside `act(async () => { await refreshControlProps.current?.onRefresh?.(); })`.

**FlatList variant.** `test/mocks/react-native.ts`'s `FlatList` mock (`createFlatListMock`) has the same practical effect for a different reason: it's a hand-written component (not a bare `mockComponent`) that explicitly destructures only `data`/`renderItem`/`keyExtractor`/`ListEmptyComponent`/`ListHeaderComponent`/`ListFooterComponent`/`testID` and builds its own children from those — it never reads `props.refreshControl` or `props.children` at all. Delegating to the mock's own `FlatList` for children doesn't work here (unlike ScrollView, passing `refreshControl` as a `React.createElement(..., children)` argument does nothing, since the component ignores its `children` prop entirely); render `refreshControl` as a sibling instead:

```typescript
const FlatList = ({ refreshControl, ...rest }: {
  refreshControl?: React.ReactNode;
} & Record<string, unknown>) =>
  React.createElement(
    React.Fragment,
    null,
    refreshControl,
    React.createElement(
      actual.FlatList as unknown as React.ComponentType<Record<string, unknown>>,
      rest,
    ),
  );
FlatList.displayName = "FlatList";
```

(The extra `as unknown as` step is required for `FlatList` specifically — `tsc` rejects a direct cast to `React.ComponentType<Record<string, unknown>>` because `FlatListProps` requires `data`/`renderItem`, which don't structurally overlap with `Record<string, unknown>`; `ScrollView`'s props don't have that conflict.)

## Why

The mock predates any test needing pull-to-refresh coverage, so nobody had reason to make it render `refreshControl`. Extending the shared `test/mocks/react-native.ts` globally would be the "proper" fix, but it changes behavior for every existing RN component test in the repo for the sake of one screen — a file-scoped override (the same technique this codebase already uses for `@gorhom/bottom-sheet`'s `onChange`/`onAnimate`/`onDismiss` capture) is the narrower, lower-blast-radius choice, and matches this project's default of scoping test-only overrides to the file that needs them.

## Exceptions

If a second or third screen test needs the same capture, that repetition is the signal to promote this into `test/mocks/react-native.ts` itself (render `refreshControl` as a child by default) rather than copy-pasting the override a third time. `ChatListScreen.test.tsx` is the second occurrence (FlatList variant) — a third one, of either variant, should promote both list-container mocks to render `refreshControl` by default instead of adding a fourth file-scoped override.

## Related Files

- `test/mocks/react-native.ts` — the shared `ScrollView`/`FlatList` mocks this override compensates for
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx` — first use of this pattern (ScrollView variant, pull-to-refresh test for `handleRefresh`)
- `client/screens/__tests__/ChatListScreen.test.tsx` — second use (FlatList variant), covering a background focus-triggered refetch that must NOT flip `refreshing`, alongside a user-initiated pull that must

## See Also

- [Coordinated pull-to-refresh for multiple queries](../design-patterns/coordinated-pull-to-refresh-multiple-queries-2026-05-13.md)
