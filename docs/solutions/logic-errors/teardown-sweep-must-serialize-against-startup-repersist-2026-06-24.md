---
title: A teardown sweep over global durable client state must serialize against the fire-and-forget startup initializers that re-write the same keys
track: bug
category: logic-errors
module: client
severity: high
tags: [auth, offline, client-state, race-condition, teardown, cross-user, async, tanstack-query]
symptoms: ['A session-teardown clear of a global (non-user-namespaced) durable store appears to run, yet the prior session''s data reappears on disk / in memory after it.', 'On a shared device, user A''s queued offline writes replay under user B, or A''s cached data rehydrates under B, even though every teardown path calls the clear helper.', 'The leak is intermittent / timing-dependent — it reproduces under force-quit-mid-teardown then cold-launch, not on a clean logout.']
applies_to: [client/hooks/useAuth.ts, client/lib/offline-queue.ts, client/lib/query-client.ts]
created: '2026-06-24'
---

# A teardown sweep over global durable client state must serialize against the fire-and-forget startup initializers that re-write the same keys

## Problem

Two client-side stores outlive a session and use **global** AsyncStorage keys (NOT
user-namespaced): the durable offline-mutation queue (`@ocrecipes_offline_queue`)
and the persisted TanStack Query cache (`@ocrecipes_query_cache`). Every
session-teardown path correctly clears both via `clearDurableLocalState()`. But
the sweep ran **concurrently** with two fire-and-forget initializers kicked off at
app module-eval / provider mount that re-write those exact keys:

- `initOfflineQueue()` (`void initOfflineQueue()` at `client/App.tsx`) reads the
  queue from disk, merges, and **`await persist()` unconditionally**.
- `PersistQueryClientProvider` asynchronously **restores** the persisted query
  cache into the in-memory `queryClient` on mount.

If the sweep's `removeItem` / `queryClient.clear()` interleaves between an
initializer's disk **read** and its later **write**, the orphaned prior-session
state is rewritten *after* the sweep — resurrected, then replayed/rehydrated under
whoever signs in next. Clearing on every teardown path is necessary but **not
sufficient**: the clear must also *win the race* against startup re-persist.

## Symptoms

- A clear helper with full call-site coverage still leaks prior-session data
  cross-user on a shared device.
- Reproduces only under a force-quit that interrupts teardown, then a cold launch
  where a *different* user logs in within the durable-state TTL.
- Token-based drain guards don't catch it: a fresh later login presents only the
  new user's token, so `tokenNow === tokenAtStart` and the mismatch guard never
  fires — the resurrected store is the load-bearing exposure.

## Root Cause

A fire-and-forget initializer that does `read → (await) → write` has an
interleaving window. A concurrent teardown sweep whose `removeItem` lands inside
that window is silently undone by the initializer's trailing write. The teardown
and the initializer touch the same global key with no ordering between them, so
the outcome is probabilistic.

## Solution

Make the sweep **deterministically ordered after** each initializer:

1. **Offline queue — serialize the clear after the in-flight load.** Capture the
   load promise **synchronously** (before its first `await`) into a module
   variable, then have the clear await it:

   ```ts
   let initPromise: Promise<void> | null = null;

   export function initOfflineQueue(): Promise<void> {
     // ??= assigns synchronously, before the first await — lock-before-await.
     initPromise ??= (async () => {
       const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
       /* …merge… */ await persist();
     })();
     return initPromise;
   }

   export async function clearOfflineQueue(): Promise<void> {
     if (initPromise) { try { await initPromise; } catch {} } // run strictly after init
     queue = [];
     await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
   }
   ```

2. **Query cache — gate the clear on restore-complete.** The async restore is
   driven by `PersistQueryClientProvider`; expose a module-level **restore gate**
   resolved from the provider's `onSuccess` **and** `onError` props (a failed
   restore must release the gate too, or teardown wedges), created **eagerly at
   module load** so a teardown that fires before the provider's restore effect
   still awaits an existing promise. Bound the await with a safety timeout so
   broken wiring can't wedge teardown forever:

   ```ts
   // App.tsx — these are PROVIDER props, NOT persistOptions fields:
   <PersistQueryClientProvider onSuccess={markQueryCacheRestored} onError={markQueryCacheRestored} … >

   // clearDurableLocalState():
   await whenQueryCacheRestored();   // restore settled (or 5s timeout)
   queryClient.clear();              // clear MEMORY first…
   await AsyncStorage.removeItem(QUERY_CACHE_KEY); // …then disk
   ```

   Clear in-memory **before** removing the disk key: the throttled persister reads
   the *live* cache when it fires, so clearing memory first means any re-persist
   only ever serializes an empty cache. Guard `queryClient.clear()` independently
   so a throwing clear can't skip the disk removal.

The queue close is fully deterministic (a hard promise dependency); the cache
close holds as long as the restore settles within the gate's timeout (always, in
normal operation — `PersistQueryClientProvider`'s re-persisting `subscribe` does
not even start until `isRestoring` is false, so the only on-disk leak path is a
clear that beats the restore).

## Prevention

- Treat any "clear global durable state on teardown" helper as a **race**, not
  just a checklist item: enumerate every fire-and-forget initializer (module-eval
  side effects, provider `useEffect` restores) that writes the same key, and make
  the clear awaitable-after-them or gate it on their completion signal.
- Single-flight / restore promises must be captured **synchronously** before the
  first `await` (see [[sync-lock-must-precede-first-await-single-flight-guard-2026-06-20]]),
  or a concurrent caller misses them.
- A regression test must drive the **real** initializer and the **real** sweep
  concurrently (stateful storage fake + a deferred read to force the interleave) —
  a test that mocks the clear helper cannot exercise the race.

## Related Files

- `client/hooks/useAuth.ts` — `clearDurableLocalState()` (the shared teardown chokepoint for all five paths)
- `client/lib/offline-queue.ts` — `initOfflineQueue()` / `clearOfflineQueue()` serialization
- `client/lib/query-client.ts` — `markQueryCacheRestored()` / `whenQueryCacheRestored()` restore gate
- `client/App.tsx` — `PersistQueryClientProvider` `onSuccess`/`onError` wiring
- `client/lib/__tests__/offline-queue.test.ts` — real-module concurrent resurrection test

## See Also

- [sync-lock-must-precede-first-await-single-flight-guard-2026-06-20](sync-lock-must-precede-first-await-single-flight-guard-2026-06-20.md) — the lock-before-await rule used to capture initPromise
- [durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19](durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the prerequisite "clear on every teardown path" rule this race-closes
- [../conventions/clear-query-cache-on-auth-teardown-2026-05-30](../conventions/clear-query-cache-on-auth-teardown-2026-05-30.md) — clearing the query cache on every teardown path
