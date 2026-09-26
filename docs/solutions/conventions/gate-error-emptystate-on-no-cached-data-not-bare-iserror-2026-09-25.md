---
title: Gate an error EmptyState on no-cached-data (isLoadingError), never bare isError
track: knowledge
category: conventions
module: client
tags: [client-state, tanstack-query, react-native, error-handling]
applies_to: [client/screens/**/*.tsx, client/hooks/use*.ts]
created: '2026-09-25'
---

# Gate an error EmptyState on no-cached-data (isLoadingError), never bare isError

## Rule

When a screen renders a dedicated error `EmptyState` (icon + copy + retry) for
a failed query, gate it on **`isLoadingError`** (TanStack Query v5: error with
no data ever fetched) — or, for a hook that hand-combines several queries, the
equivalent `error && !data` — never on the broader `isError`. A background
refetch failure over data that already loaded successfully (`isRefetchError`)
must fall through to the normal content render and keep showing the stale
data, not blank the screen.

## When this applies

Any screen/hook with a query whose failure should show a retry affordance
instead of silently collapsing into (or blanking) the content branch. Three
in-repo instances now follow this shape:

- `client/hooks/useHistoryData.ts` — hand-computes `isError = (summaryError &&
  !todaySummary) || (historyError && allItems.length === 0)`, i.e. "error AND
  no cached data," predating TanStack's own `isLoadingError`/`isRefetchError`
  flags.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — the existing
  `budgetErrorNoData = budgetError && !budgetData` gate for the calorie-ring
  EmptyState, and the newer `isLoadingError` gate (destructured directly off
  `useMealPlanItems()`, a plain `useQuery`) for the meal-plan-items EmptyState.
- `client/screens/FeaturedRecipeDetailScreen.tsx` — the generic-error branch is
  gated on `error && !isNotFoundError && !normalized`, so a refetch failure
  over an already-normalized recipe keeps showing that recipe.

## Smell patterns

- `if (isError) { return <EmptyState .../> }` where `isError` comes straight
  off a `useQuery` result with no `!data` / `isLoadingError` qualifier —
  blanks a perfectly good stale render on every background refetch blip
  (pull-to-refresh, focus-refetch).
- A screen that never checks the query's error flag at all (the pre-fix state
  of both files above) — a failed initial fetch then renders as if the query
  had legitimately resolved to empty/default data (an empty list, a null
  detail), not as a failure. See
  `docs/solutions/logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md`
  for the sibling "don't assert a false cause" rule this pairs with.

## Why

TanStack Query v5 computes both flags for you (`packages/query-core/src/queryObserver.ts`):

```ts
const hasData = data !== undefined;
isLoadingError: isError && !hasData; // first fetch failed, nothing cached
isRefetchError: isError && hasData; // background refetch failed, stale data present
```

A plain `isError` conflates these two very different situations. Gating on
`isLoadingError` specifically gets the "keep stale data on a refetch error"
behavior for free — no extra code path is needed, because the branch simply
doesn't fire when there's data to fall through to.

This is the same underlying TanStack fact
(`isLoading` becomes `false` on error while `data` stays `undefined`) as
[`docs/solutions/conventions/isloading-false-on-error-not-resolved-2026-06-12.md`](isloading-false-on-error-not-resolved-2026-06-12.md),
applied to a different consumer: that rule is about a **mount-once**
navigation decision (`initialRouteName`), this one is about a **per-render**
UI branch (which EmptyState/content to show). Use the sentinel-boolean pattern
there; use `isLoadingError`/`isRefetchError` (or the hand-rolled equivalent)
here.

## Examples

**Wrong — blanks stale content on any error:**

```tsx
const { data, isError } = useMealPlanItems(startDate, endDate);
if (isError) return <EmptyState title="Couldn't load your meal plan" .../>;
// A background refetch failure with `data` still populated from the last
// successful fetch now shows the error state instead of the cached week.
```

**Correct — only the no-data case shows the error branch:**

```tsx
const { data, isLoadingError, refetch } = useMealPlanItems(startDate, endDate);
if (isLoadingError) {
  return (
    <EmptyState
      variant="temporary"
      icon="alert-circle"
      title="Couldn't load your meal plan"
      description="Something went wrong loading this week's meals. Check your connection and try again."
      actionLabel="Try Again"
      onAction={() => void refetch()}
    />
  );
}
// isRefetchError falls through here unchanged — `data` is still the last
// successfully-fetched week, so the normal render keeps showing it.
```

For a hook combining multiple queries by hand (no single `useQuery` to read
`isLoadingError` off), derive the equivalent directly: `error && !data`.

## Related Files

- `client/hooks/useHistoryData.ts`
- `client/screens/meal-plan/MealPlanHomeScreen.tsx`
- `client/screens/FeaturedRecipeDetailScreen.tsx`
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`
- `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`
- `test/utils/render-component.tsx`
- `client/lib/query-client.ts`

## See Also

- [isLoading=false on query error does not mean data resolved](isloading-false-on-error-not-resolved-2026-06-12.md) — the mount-once-gate sibling of this per-render rule
- [Static error copy that collapses every failure into one cause tells the user a falsehood](../logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md) — the "don't assert a false cause" rule this pairs with when distinguishing a 404 from a generic error
- [RN component render-test pattern (jsdom)](rn-component-render-test-jsdom-pattern-2026-05-16.md) — testing a screen whose query relies on the default `queryFn` (the render harness's `QueryClient` doesn't register one)
