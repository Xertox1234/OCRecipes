---
title: Overlapping taps on an optimistic toggle can end on the wrong state — serialize with a mutation scope and let only the last tap reconcile
track: bug
category: logic-errors
tags: [hooks, client-state, testing, tanstack-query, optimistic-update, mutation-scope, race]
module: client
applies_to: [client/hooks/**/*.ts, client/hooks/__tests__/*.ts]
symptoms: ["Tap then quickly untap a like-style toggle: the button flips back to the first tap's state, briefly or for good", "PUT and DELETE for the same resource are in flight at once", "A 'last tap wins' test awaits mutateAsync(true) before calling mutateAsync(false)"]
created: 2026-10-10
severity: medium
---

# Overlapping taps on an optimistic toggle can end on the wrong state — serialize with a mutation scope and let only the last tap reconcile

## Problem

`useSetRecipeTried` (PR #1365) used the standard optimistic pattern: snapshot in `onMutate`, roll back in `onError`, invalidate in `onSettled`. With a single tap that is correct. With two quick taps (tap, untap) it fails three ways:

1. **Request order.** `useMutation` runs each `mutate` call immediately, so PUT and DELETE race. The server can apply them out of order and finish on the opposite of the last tap.
2. **Refetch clobber.** The first call settles and invalidates the stats query. That refetch returns the *intermediate* server state ("tried") and overwrites the second tap's optimistic "untried" while the DELETE is still in flight.
3. **Rollback clobber.** If the first call fails, `onError` restores the snapshot taken before it, which overwrites every later tap's optimistic state.

## Symptoms

- The button flickers back to the previous state, or settles on it.
- The test that was meant to cover this awaited each `mutateAsync` before starting the next, so the requests never overlapped and it passed against the broken hook. Two reviewers found the gap by reading; the test did not.

## Root Cause

The optimistic-update recipe assumes one mutation in flight per cache entry. Each callback acts on its own snapshot and does not know whether a later mutation for the same entry is queued.

## Solution

TanStack Query 5.101 (`client/hooks/useRecipeCommunity.ts`):

```ts
const mutationKey = ["set-recipe-tried", recipeId];
// The settling call still counts as pending inside its own onError/onSettled.
const laterTapPending = () => queryClient.isMutating({ mutationKey }) > 1;

useMutation({
  mutationKey,
  scope: { id: `set-recipe-tried-${recipeId}` }, // one request at a time, in order
  onMutate: /* unchanged — still runs immediately, so the UI responds at once */,
  onError: (_e, _v, ctx) => {
    if (ctx?.previous && !laterTapPending()) queryClient.setQueryData(key, ctx.previous);
  },
  onSettled: () => {
    if (!laterTapPending()) void queryClient.invalidateQueries({ queryKey: key });
  },
});
```

Why `> 1` is right, from `@tanstack/query-core` `mutation.js`:
- `isMutating` counts mutations with `status: "pending"`.
- `onError` and `onSettled` run *before* the mutation dispatches `error` or `success`, so the settling call is still pending inside its own callbacks.
- A queued, scoped mutation is dispatched pending (paused) before its `onMutate`, so it is counted while it waits.
- The scope runs the next mutation in `finally`, after the settle, so the last tap sees a count of 1 and reconciles.

## Prevention

Test overlap explicitly:
- Start both `mutate` calls without awaiting.
- Hold the first response on a deferred promise.
- Assert the second request has not been sent.
- Resolve the first, then assert the cache still shows the last tap and no refetch happened.

**Render the query hook in the same `renderHook` as the mutation.** `invalidateQueries` only refetches *observed* queries. A test that seeds the cache with `setQueryData` and renders only the mutation never refetches, so it can neither catch the refetch clobber nor prove the final reconcile. Count the GETs after mount and assert on the delta. Watch both tests fail against the pre-fix hook.

## Related Files

- `client/hooks/useRecipeCommunity.ts` — `useSetRecipeTried`
- `client/hooks/__tests__/useRecipeCommunity.test.ts` — the "overlapping taps" describe block
- `client/components/RecipeTriedBar.tsx` — the toggle that calls it

## See Also

- [interpolated-query-key-element-defeats-prefix-invalidation-2026-09-25.md](interpolated-query-key-element-defeats-prefix-invalidation-2026-09-25.md) — another way an invalidation silently fails to reach the query you meant
- [../conventions/render-on-issuccess-not-data-when-a-refetch-can-404-2026-10-10.md](../conventions/render-on-issuccess-not-data-when-a-refetch-can-404-2026-10-10.md) — the same hook's read side
