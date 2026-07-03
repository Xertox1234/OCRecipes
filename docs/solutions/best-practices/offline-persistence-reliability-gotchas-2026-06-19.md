---
title: 'Offline persistence reliability: onlineManager is transition-only, PersistQueryClient needs an allowlist + buster, and a merge-on-init must re-persist'
track: knowledge
category: best-practices
module: client
severity: medium
tags: [offline, tanstack-query, persistquerysclient, onlinemanager, async-storage, reliability, react-native, query-cache]
applies_to: [client/App.tsx, client/lib/query-client.ts, client/lib/offline-queue.ts, client/lib/offline-queue-drain.ts, client/lib/query-keys.ts, client/screens/*.tsx]
created: '2026-06-19'
last_updated: '2026-06-20'
---

# Offline persistence reliability gotchas (TanStack Query + AsyncStorage)

Four non-obvious failure modes found auditing the offline-persistence feature.
Each is verified against current TanStack Query v5 behavior and the installed
`@tanstack/query-core` source.

## When this applies

Any time you wire TanStack Query's `onlineManager` / `PersistQueryClientProvider`
or hand-roll a durable AsyncStorage queue in React Native.

## Why / the gotchas

**1. `onlineManager.subscribe` is transition-only — it does NOT drain on a cold
start that is already online.** The installed `Subscribable.subscribe` just adds
the listener; the callback fires only via `setOnline(online)` and only when the
value *changed*. `onlineManager` defaults `#online = true`, and the NetInfo
wiring treats the initial `isConnected: null` as online — so `true → true` is no
transition and the subscriber never fires on launch. A queue from a prior session
(offline-log → force-quit → reopen online) sits unsynced until an unrelated
connectivity blip. Fix: an explicit one-shot drain after init:

```ts
void initOfflineQueue().then(() => {
  if (onlineManager.isOnline()) void drainQueue();   // cold-start drain
});
onlineManager.subscribe((isOnline) => { if (isOnline) void drainQueue(); }); // transitions
```

(The library's own `resumePausedMutations()` subscribe has the identical
cold-start gap.) The doc text claiming subscribe "fires immediately with the
current state" is contradicted by the installed source — trust the source.

**2. `PersistQueryClientProvider` persists the ENTIRE cache by default — add a
`shouldDehydrateQuery` allowlist.** With only `persister` + `maxAge`, every
successful query is serialized into ONE AsyncStorage row on each (throttled)
write. Large/long-list payloads (recipe browse/search, chat history, carousel)
risk the Android SQLite CursorWindow ~2MB limit (silent truncation under a
swallowed `.catch`). Allowlist the small, offline-critical keys:

```ts
persistOptions={{
  persister, maxAge, buster: PERSIST_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: (q) =>
      defaultShouldDehydrateQuery(q) && PERSISTED_QUERY_KEYS.has(q.queryKey[0]),
  },
}}
```

Note this is a real behavior change: non-allowlisted reads are no longer
available offline — confirm that's acceptable for each excluded surface.

**3. No `buster` → a post-update shape change serves stale old-shape cache as
fresh.** `buster` is a first-class `PersistQueryClientOptions` field that
discards the persisted cache on restore when it doesn't match. Without it, after
an app update changes a query's data shape, the old-shape cache is restored and
served fresh (within `maxAge`/`staleTime`) → crashes on `undefined` fields. Bump
a manual `PERSIST_BUSTER` constant when a persisted query's shape changes
incompatibly (NOT the app version — that over-busts every release).

**4. A merge-on-init must re-persist unconditionally — or it relocates a clobber
instead of fixing it.** If `initOfflineQueue` merges persisted + any in-memory
entries enqueued during the `getItem` await window but only persists via a
*conditional* `clearStale()` (which writes only when it filters), the merged set
lives memory-only and the persisted-older entries are lost on the next
force-quit. The mid-load `enqueue` already clobbered storage to just its own
entry. Add `await persist()` right after the merge, before `clearStale()`.

**5. Both the persist allowlist (#2) AND `invalidateQueries` prefix-matching key
on `queryKey[0]` — so a single-resource read MUST use the tuple form, not a
template-literal string, or it silently excludes itself from both.** The default
`getQueryFn` joins the key with `/`, so `[`/api/scanned-items/${id}`]` and
`["/api/scanned-items", id]` produce the **same URL** — they look interchangeable
but are not. The string form's `queryKey[0]` is `"/api/scanned-items/<id>"`,
which (a) is not in `PERSISTED_QUERY_KEYS` (built from `QUERY_KEYS[*][0]`), so the
read is never persisted offline, and (b) does not prefix-match
`invalidateQueries({ queryKey: ["/api/scanned-items"] })`, so list-mutating
flows (favourite, discard, photo-analysis) never refresh that detail → a stale
single-item read with no crash. Always key a per-`id` read as
`[<resource-base>, id]` (matching `QUERY_KEYS.<resource>[0]`); the tuple `[0]`
then joins the prefix-invalidation family and the persist allowlist
automatically. A length-1 list key (`["/api/scanned-items"]`) and a length-2
detail key (`["/api/scanned-items", id]`) coexist as distinct cache entries that
share invalidation and persistence — that is the intended shape, and
`setQueryData(QUERY_KEYS.scannedItems, …)` optimistic writes target only the
exact length-1 list key, never the length-2 detail.

## Examples

See `client/App.tsx` (cold-start drain, persist allowlist + buster) and
`client/lib/offline-queue.ts` `initOfflineQueue` (merge + unconditional persist).
For the tuple-key rule (#5), see `client/hooks/useNutritionLookup.ts`'s
`existingItem` query and `client/screens/ItemDetailScreen.tsx` — both key the
single scanned-item read as `["/api/scanned-items", itemId]`.

## Related Files

- `client/App.tsx` — persistOptions (`buster`, `dehydrateOptions`), cold-start drain wiring
- `client/lib/query-client.ts` — `onlineManager.setEventListener` (NetInfo), `asyncStoragePersister`
- `client/lib/offline-queue.ts` — `initOfflineQueue` merge + persist
- `client/lib/offline-queue-drain.ts` — `drainQueue` invalidates once after the loop
- `client/lib/query-keys.ts` — `QUERY_KEYS`; the allowlist + prefix-invalidation key on `[0]` (gotcha #5)
- `client/screens/ItemDetailScreen.tsx` — single scanned-item read keyed as the tuple `["/api/scanned-items", itemId]` (gotcha #5)

## See Also

- [Durable write-queue not cleared on auth teardown](../logic-errors/durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the security sibling from the same feature
- Process note: the merge-on-init persist gap (#4) was a fix that *relocated* the bug from memory to storage; the per-cluster test passed because it mocked `setItem` and only asserted in-memory state. A whole-diff review reasoning across init → clearStale → persist caught it. When a fix touches a persistence path, assert the DURABLE side, not just the in-memory result.
