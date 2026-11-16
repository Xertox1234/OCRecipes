---
title: A control that shows a mutation's pending value flicks back to the old value when the mutation settles before the refetch — return the invalidation promise from onSuccess
track: bug
category: logic-errors
tags: [client-state, hooks, tanstack-query, mutation, optimistic-ui]
module: client
applies_to: ["client/hooks/**/*.ts", "client/hooks/**/*.tsx"]
symptoms: ["a switch turns on, drops back to off for a moment, then turns on again", "rows that depend on the saved value appear a beat after the control changes", "value is computed as isPending ? variables : valueFromAQuery"]
created: 2026-11-16
severity: low
---

# A control that shows a mutation's pending value flicks back when the mutation settles before the refetch

## Problem

The "Plan for my family" switch reads `mutation.isPending ? mutation.variables : committed`, where `committed` comes from the dietary profile query. `useSetFamilyPlanning` invalidated that query with `void queryClient.invalidateQueries(...)` in `onSuccess`. The mutation settled as soon as the PUT answered, while the query still held the old value, so the switch showed: new value (pending), old value (settled, stale query), new value (refetched).

A second defect sat in the same handler: on switch-off it invalidated the family profile list. A screen still mounted in another tab had an enabled observer on that list (the query that says "family planning is off" had not been refetched yet), so the list was fetched once more right after the user turned the feature off.

## Symptoms

- A toggle visibly bounces after a successful save.
- A list that should stop loading is requested one more time after the feature is turned off.

## Root Cause

`onSuccess` is awaited by the mutation. A handler that fires its invalidation with `void` returns at once, so `isPending` goes false before the data the UI falls back to is fresh.

`invalidateQueries` refetches every active observer of the key. "Active" is decided by each observer's current `enabled`, which may still be computed from stale data.

## Solution

Return the invalidation of the query the control reads, and remove (not invalidate) data that should no longer be fetched:

```ts
onSuccess: (_data, enabled) => {
  if (enabled) {
    void queryClient.invalidateQueries({ queryKey: familyProfilesKey() });
  } else {
    queryClient.removeQueries({ queryKey: familyProfilesKey() });
  }
  // Returned: the mutation stays pending until the profile is refetched.
  return queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dietaryProfile });
},
```

The returned promise resolves even when the refetch fails (`throwOnError` defaults to false) and resolves at once when no observer is mounted, so the control cannot stay stuck in the pending state.

## Prevention

- When a control's value is `isPending ? variables : fromQuery`, the mutation's `onSuccess` must return the invalidation of that query (or write the new value with `setQueryData`).
- Test it: hold the invalidation promise open, assert `isPending` is still true after the request has answered, then release it.
- `onSuccess` must not be an `async` function passed as a mutate-time callback: type-aware lint rejects it (`no-misused-promises`). Return the promise from a plain function, or chain with `.then`.

## Related Files

- `client/hooks/useFamily.ts` — `useSetFamilyPlanning`
- `client/hooks/useFamilySwitch.ts` — the switch's value
- `client/hooks/__tests__/useFamily.test.tsx` — the pending-until-refetched test and the switch-off test

## See Also

- [type-aware lint runs only at push](../conventions/pre-commit-skips-type-aware-eslint-run-it-before-push-2026-06-19.md) — why the async callback was caught late
