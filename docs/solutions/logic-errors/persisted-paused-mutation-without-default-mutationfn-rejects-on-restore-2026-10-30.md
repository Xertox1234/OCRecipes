---
title: "A persisted paused mutation without a setMutationDefaults mutationFn rejects 'No mutationFn found' on restore — and restored ones never resume on an online cold start"
track: bug
category: logic-errors
module: client
tags: [client-state, typescript, tanstack-query, persistquerysclient, offline, mutations, reliability]
applies_to: [client/lib/query-client-persistence.ts, client/lib/query-client.ts, client/App.tsx]
symptoms: ["A generic error toast appears right after app launch with nothing the user did", "Sentry/global error net logs 'No mutationFn found' on startup", "A write the user made offline before force-quitting silently never happens", "Restored paused mutations sit pending until an unrelated connectivity blip"]
created: '2026-10-30'
severity: medium
---

# A persisted paused mutation without a default `mutationFn` rejects on restore

## Problem

`PersistQueryClientProvider` dehydrates **paused** mutations by default. A dehydrated mutation
keeps its `mutationKey` and `variables` but **not** its `mutationFn` (functions don't serialize).
On restore it gets one only from `queryClient.setMutationDefaults(key, { mutationFn })`. Every
inline `useMutation({ mutationFn })` in the app has no such default, so `resumePausedMutations()`
runs it and it rejects `No mutationFn found` (confirmed in `@tanstack/query-core`'s `Mutation`
`execute`). The global `MutationCache.onError` net turns that into a spurious error toast for a
write that never happened.

Separately, the provider's `onSuccess` never called `resumePausedMutations()`. The library
resumes paused mutations only on an `onlineManager` **transition**; an online cold start is
`true → true`, no transition, so restored mutations stay paused until the next blip (the same
cold-start gap as `onlineManager.subscribe` — see the gotchas doc).

## Symptoms

See frontmatter.

## Root Cause

The default dehydrate predicate (`isPaused`) assumes every mutation is resumable. It is only
resumable if a function for its key is registered globally before restore.

## Solution

```ts
// client/lib/query-client-persistence.ts
export function shouldDehydrateResumableMutation(mutation) {
  if (!mutation.state.isPaused) return false;
  const key = mutation.options.mutationKey;
  if (!key) return false;
  return queryClient.getMutationDefaults(key).mutationFn !== undefined;
}

export function handleQueryCacheRestored(): void {
  markQueryCacheRestored();               // release the durable-sweep restore gate
  queryClient.resumePausedMutations().catch(() => {});
}
```

Wire `dehydrateOptions.shouldDehydrateMutation: shouldDehydrateResumableMutation` and
`onSuccess={handleQueryCacheRestored}` in `App.tsx`. To make a mutation durable across restarts,
give it a `mutationKey` and register `setMutationDefaults(key, { mutationFn })` — it is then
persisted and resumed automatically. Only opt in writes that are safe to replay (idempotent);
the opt-in registry is `client/lib/mutation-defaults.ts` (four on/off toggles as of 2026-11-01;
its header classifies every `useMutation` site). Register from `query-client-persistence.ts`,
never from `query-client.ts` (circular), and export the key and `mutationFn` for the hook to
share. The registry holds `onSettled`/`onSuccess` too: a restored mutation has only the defaults,
so the hook's own handlers are gone.

## Prevention

- Treat "persist paused mutations" as two halves: something must be able to run them after
  restore (a registered default), and something must start them (`resumePausedMutations` on
  restore, not only on reconnect). Missing either is a silent failure.
- The provider's `onError` passes no error argument — report a fixed `Error` and still release
  any restore gate (`handleQueryCacheRestoreFailed`), so a failed restore can't wedge teardown.

## Related Files

- `client/lib/mutation-defaults.ts` — the opt-in registry
- `client/lib/query-client-persistence.ts` — `shouldDehydrateResumableMutation`, `handleQueryCacheRestored`, `handleQueryCacheRestoreFailed`, `subscribeToPausedMutations`
- `client/App.tsx` — `persistOptions.dehydrateOptions`, provider `onSuccess`/`onError`
- `client/lib/__tests__/query-client-persistence.test.ts`

## See Also

- [Offline persistence reliability gotchas](../best-practices/offline-persistence-reliability-gotchas-2026-06-19.md) — gotcha #1 is the same transition-only cold-start gap for `onlineManager.subscribe`
- [Offline drain classifies by status meaning](offline-drain-evicts-on-transient-status-and-head-of-line-blocks-2026-10-30.md) — the hand-rolled durable queue that backs the food-log writes
