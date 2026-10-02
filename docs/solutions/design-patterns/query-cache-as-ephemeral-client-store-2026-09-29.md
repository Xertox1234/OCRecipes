---
title: "Store ephemeral, session-scoped client state in the TanStack Query cache instead of a module-level singleton — but pin gcTime and never write undefined expecting a clear"
track: knowledge
category: design-patterns
tags: [tanstack-query, client-state, query-client, lifecycle, react-native]
module: client
applies_to: [client/hooks/**/*.ts, client/screens/FrontLabelConfirmScreen.tsx, client/screens/LabelAnalysisScreen.tsx]
created: '2026-09-29'
last_updated: '2026-10-02'
---

# Store ephemeral, session-scoped client state in the TanStack Query cache instead of a module-level singleton

## Rule

When a small piece of client-only state needs to (a) be shared across components without
prop-drilling or context, (b) be READ back later without necessarily ever being fetched via
`useQuery`, and (c) be cleared automatically on every auth teardown path
(logout/expireSession/deleteAccount) — write it into the existing `queryClient` under a dedicated
sentinel key (`queryClient.setQueryData`/`getQueryData`) rather than a bare module-level
`let`/`Map`. `queryClient.clear()` already runs on all three teardown paths
(`../conventions/clear-query-cache-on-auth-teardown-2026-05-30.md`), so this reuses an
already-audited lifecycle instead of adding a NEW module-mutable-singleton lifecycle bug class
(`global-mutable-client-singleton-lifecycle-2026-06-19.md`).

This works well for a value nothing ever renders directly from via `useQuery` — e.g. a
cross-screen coordination marker (`client/hooks/useChat.ts`'s `["__pendingRecipeTurns"]`, read by
a `refetchInterval` decision function on OTHER queries). It has two gotchas that make it unsafe
without care:

1. **`setQueryData(key, undefined)` is a no-op, not a clear.** TanStack Query's `setQueryData`
   treats a resulting value of `undefined` as "nothing to write" and leaves the PREVIOUS data in
   place (`@tanstack/query-core`'s `queryClient.js`: `if (data === void 0) { return void 0; }`).
   To actually clear a map-shaped entry, write `{}` (or whatever empty-but-defined value matches
   your read-side "is anything pending" check), never `undefined`.
2. **An entry with no `useQuery` observer never reschedules its `gcTime` timer.** A query created
   purely via `setQueryData` (nothing ever subscribes to it with `useQuery`) gets its
   garbage-collection timer scheduled ONCE, at first creation, using the default `gcTime` (5
   minutes) unless overridden — and later `setQueryData` writes do NOT reschedule it (only
   `addObserver`/`removeObserver` do). If your value needs to outlive 5 minutes between writes
   with nothing else touching the key, pin it explicitly:
   `queryClient.setQueryDefaults(key, { gcTime: Infinity })`, called before the first write.

## Why

The alternative (a bare module-level `Map`/`let`) has its OWN documented failure class — no
per-session lifecycle, no launch-hook discipline
(`global-mutable-client-singleton-lifecycle-2026-06-19.md`) — that this project has been burned by
before (the offline-mutation-queue audit). Riding the query cache's ALREADY-correct teardown
avoids reintroducing that class, but only if you know the two gotchas above; both were caught by
review AFTER the mechanism initially shipped with a silent early-expiry bug (gotcha 2) and a mark
that never cleared on resolution (gotcha 1), in `client/hooks/useChat.ts`'s recipe/remix
post-abort poll (P3-2026-09-26).

## Examples

```ts
// Session-scoped marker: wiped for free by queryClient.clear() on every
// auth teardown path, survives across screens without a Context provider.
const PENDING_KEY = ["__pendingRecipeTurns"] as const;

export function useMarkPendingRecipeTurn() {
  const queryClient = useQueryClient();
  // Pin BEFORE the first write — no useQuery ever subscribes to this key,
  // so nothing else would ever reschedule its gcTime.
  queryClient.setQueryDefaults(PENDING_KEY, { gcTime: Infinity });
  return useCallback(
    (id: number) => {
      queryClient.setQueryData<Record<number, number>>(PENDING_KEY, (prev) => ({
        ...(prev ?? {}),
        [id]: Date.now(),
      }));
    },
    [queryClient],
  );
}

// Clearing: write {} to an empty result, never undefined.
queryClient.setQueryData(PENDING_KEY, remainingEntries); // {} when empty — NOT `undefined`
```

## Exceptions

- If the value legitimately needs disk persistence across app restarts, this pattern alone is
  insufficient — check `client/App.tsx`'s `PersistQueryClientProvider`/`shouldDehydrateQuery`
  allowlist; a sentinel key like this should stay OUT of that allowlist (in-memory-only) unless
  the value is meant to survive a cold start too.
- For state a component DOES want to read reactively, observe it with `useQuery`. A cache-only key
  has no fetcher, so give the observer `queryFn: skipToken`, `gcTime: Infinity` and a `select` that
  returns a primitive (`useHasUnreadCoachReply` in `client/hooks/useCoachUnreadReplies.ts`).
  `skipToken` beats `enabled: false`: it also overrides the app-wide default `queryFn`, so not
  even an explicit `refetch()` becomes an API call keyed on the sentinel, and a client with no
  default `queryFn` (every test wrapper) logs no dev error per render. The gcTime gotcha only
  bites keys nothing subscribes to, but keep pinning in the writers: the first write can precede
  the observer. Three behaviours to know (measured against `@tanstack/react-query` 5.101.0;
  re-measure after an upgrade):
  - Observer notifications are batched onto a macrotask, so a test must `waitFor` (or flush one
    macrotask inside `act`) before asserting on the hook's output.
  - `queryClient.clear()` leaves a MOUNTED observer's `data` stale until its host re-renders,
    and a write after `clear()` is not delivered to it. Moot when the host unmounts at logout
    (the tab navigator does); it matters for a host that survives teardown.
  - An unfiltered `resetQueries()` / `removeQueries()` wipes the sentinel; an unfiltered
    `invalidateQueries()` leaves it alone. No client code calls either today.
  The whole pattern built on this is in
  [away-detection-focus-marker-and-unread-marks-in-query-cache-2026-10-01.md](away-detection-focus-marker-and-unread-marks-in-query-cache-2026-10-01.md).

## Related Files

- `client/hooks/useChat.ts` — `useMarkPendingRecipeTurn`, `pollRecipeTurn`,
  `PENDING_RECIPE_TURNS_KEY`
- `client/hooks/__tests__/useChat.test.ts` — the gcTime-survival and setQueryData-clear regression
  tests
- `client/hooks/useCoachUnreadReplies.ts` — a second sentinel pair; the unread marks are observed
  through `useQuery({ queryFn: skipToken, select })`, the viewed-conversation marker is not
- `client/hooks/__tests__/useCoachUnreadReplies.test.ts` — gcTime survival for both keys, the
  `[]` / `null` clears, `queryClient.clear()`, and the macrotask flush the observer needs
- `client/screens/FrontLabelConfirmScreen.tsx` — the one screen-level instance: the save's
  `onSuccess` pins `frontLabelSavedKey` (`setQueryDefaults`, `gcTime: Infinity`) and writes it
  before `pop(2)`; `client/screens/LabelAnalysisScreen.tsx` reads it back in its `useFocusEffect`

## See Also

- [Clear the TanStack Query cache on every local auth teardown](../conventions/clear-query-cache-on-auth-teardown-2026-05-30.md)
- [Global mutable client singletons holding user data](global-mutable-client-singleton-lifecycle-2026-06-19.md)
- [Tell the user a result landed while they were away](away-detection-focus-marker-and-unread-marks-in-query-cache-2026-10-01.md) — the focus-tracked marker plus unread marks built on this store
