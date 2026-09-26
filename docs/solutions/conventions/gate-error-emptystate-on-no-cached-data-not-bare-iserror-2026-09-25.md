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

**Correct — only the no-data case shows the error, rendered where the data would go:**

```tsx
const { data, isLoading, isLoadingError, refetch } = useMealPlanItems(start, end);
if (isLoading) return <Skeleton />; // first load only; unchanged

return (
  <ScrollView refreshControl={<RefreshControl onRefresh={handleRefresh} ... />}>
    <TopActions />   {/* don't depend on this query — stay usable */}
    <DateStrip />    {/* week navigation stays usable */}
    {isLoadingError ? (
      <EmptyState
        variant="temporary"
        icon="alert-circle"
        title="Couldn't load your meal plan"
        actionLabel="Try Again"
        onAction={() => void refetch()}
      />
    ) : data.length === 0 ? (
      <EmptyState variant="firstTime" title="No meals planned yet" ... />
    ) : (
      <MealList items={data} />
    )}
  </ScrollView>
);
// isRefetchError falls through unchanged — `data` is still the last
// successfully-fetched week, so the normal render keeps showing it.
```

Render the error **in place of the failed query's content**, not as a
full-screen early return. An early return discards everything that doesn't
depend on the failed query — on `MealPlanHomeScreen` that was the week
navigation (so the user couldn't even try a different week), the top-action
buttons, and pull-to-refresh (whose handler also refreshes sibling queries the
lone Try Again didn't). The error branch must come **before** the empty-data
branch, or a failed fetch falls into "No meals planned yet" again. The same
file's `budgetErrorNoData` calorie-ring EmptyState was already in-scroll; follow
that precedent.

For a hook combining multiple queries by hand (no single `useQuery` to read
`isLoadingError` off), derive the equivalent directly: `error && !data`.

## Announcing the error EmptyState: edge-detect, don't re-test state

An error `EmptyState` has no live region, so screens announce it with
`AccessibilityInfo.announceForAccessibility`. Make that effect
**edge-triggered on the visible error itself**: announce when the error rises,
re-arm only when it clears. The broken shape re-tests state inside an effect
whose deps include something else:

```tsx
// WRONG — fires on ANY deps change while the budget error is up
useEffect(() => {
  if (budgetErrorNoData && !isLoadingError) announce("Couldn't load your calorie budget…");
}, [budgetErrorNoData, isLoadingError]);
```

TanStack resets a data-less query to `pending`/`error: null` on refetch, so
tapping the *items* Try Again flipped `isLoadingError` false (skeleton on
screen) and the budget announcement fired — describing UI that was hidden —
and again on every tap. The fix (`MealPlanHomeScreen.tsx`,
`budgetErrorAnnouncedRef`): a ref seeded with the mount-time visibility (so a
screen that opens already errored stays quiet), cleared only when
`budgetErrorNoData` falls, and the announce deferred while the skeleton
(`isLoading`) replaces the EmptyState — a skeleton covering the error is not
the error clearing. Test it with a rerender walk: happy → both queries fail →
announced once → items retry (pending, then error) → still once.

**Two edge-triggered announcements can still collide.** Once both error
EmptyStates can be on screen together, both can rise in the **same commit**:
a shared outage, or items failing while a skeleton-deferred budget error is
waiting. Two separate effects then post back to back, and iOS VoiceOver drops
one of them, so the user never hears that the budget also failed. Compute both
rises in **one** effect and speak a single combined sentence when they rise
together (`MealPlanHomeScreen.tsx`: "Couldn't load your meal plan or calorie
budget."). Assert the **total** call count (`toHaveBeenCalledExactlyOnceWith`),
not a filter on one string; a per-copy filter cannot see the second post. Pin
each mount-time seed with a "mounts already errored → no announcement" test.

**The global error toast is a second announcer.** `Toast.tsx` announces its
message on iOS, and the `QueryCache.onError` net shows it from the same
query-settling event as the screen's own error state, so the two collide in
one commit. You cannot always opt the query out: a `silentError` on a
shared key is mount-order-dependent. `FeaturedRecipeDetailScreen`'s
community query keeps the toast because `RecipeChatScreen` reads the same key
with no error UI of its own. Instead, the screen asks the net's own predicate,
`shouldSurfaceQueryError(error, meta)`. When that returns true the toast will
speak, so the screen stays quiet. A 404 is suppressed by the net, so "Recipe
not found." is still announced by the screen.

## Related Files

- `client/hooks/useHistoryData.ts`
- `client/screens/meal-plan/MealPlanHomeScreen.tsx`
- `client/screens/FeaturedRecipeDetailScreen.tsx`
- `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx`
- `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`
- `test/utils/render-component.tsx`
- `client/lib/query-client.ts`

## See Also

- [Two announceForAccessibility calls in the same commit collide on iOS](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — why a joint rise must be one utterance

- [isLoading=false on query error does not mean data resolved](isloading-false-on-error-not-resolved-2026-06-12.md) — the mount-once-gate sibling of this per-render rule
- [Static error copy that collapses every failure into one cause tells the user a falsehood](../logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md) — the "don't assert a false cause" rule this pairs with when distinguishing a 404 from a generic error
- [RN component render-test pattern (jsdom)](rn-component-render-test-jsdom-pattern-2026-05-16.md) — testing a screen whose query relies on the default `queryFn` (the render harness's `QueryClient` doesn't register one)
