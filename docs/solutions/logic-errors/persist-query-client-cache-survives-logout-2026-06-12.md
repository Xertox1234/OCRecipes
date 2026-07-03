---
title: PersistQueryClientProvider cache survives logout — cross-user data visible on cold launch
track: bug
category: logic-errors
module: client
severity: high
tags: [tanstack-query, persistence, auth, asyncstorage, offline]
symptoms: ['Cold launch after another user logs in shows the previous user''s nutrition data, history, or profile briefly', Stale query data visible before the new user's queries resolve, App appears logged-out but still displays private data from the prior session]
applies_to: [client/hooks/useAuth.ts, client/lib/query-client.ts]
created: '2026-06-12'
---

# PersistQueryClientProvider cache survives logout — cross-user data visible on cold launch

## Problem

`queryClient.clear()` clears the **in-memory** TanStack Query cache only. When `PersistQueryClientProvider` is in use, a serialized snapshot of the cache is also written to AsyncStorage at key `@ocrecipes_query_cache`. This snapshot is NOT removed by `queryClient.clear()`.

On a shared device (family member, partner), if User A logs out and User B logs in, User B's cold launch rehydrates User A's cached data from AsyncStorage. This data is displayed while User B's queries are refetching — a high-severity privacy leak.

## Symptoms

- User logs out, another user logs in on the same device
- Brief flash of wrong user's data on Home, History, or Profile screens before background refetch resolves
- Only reproducible on cold launch (app was killed between sessions); hot reload clears in-memory cache

## Root Cause

`PersistQueryClientProvider` writes a serialized dehydrated snapshot to AsyncStorage via `throttleTime: 1000` (at most once per second). `queryClient.clear()` only operates on the in-memory cache object. The AsyncStorage entry is an entirely separate persistence layer that `clear()` does not touch.

```ts
// This does NOT clear the AsyncStorage snapshot:
queryClient.clear();

// Both are required:
await AsyncStorage.removeItem("@ocrecipes_query_cache");
queryClient.clear();
```

## Solution

Every auth teardown path must call `AsyncStorage.removeItem` on the persisted cache key **before** `queryClient.clear()`, inside the same `try/catch` guard:

```ts
const QUERY_CACHE_KEY = "@ocrecipes_query_cache";

// In logout(), expireSession(), deleteAccount() — all three paths:
try {
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  queryClient.clear();
} catch {}
```

Define `QUERY_CACHE_KEY` as a local constant in `useAuth.ts` rather than importing from `query-client.ts` to avoid pulling in the entire query-client module.

## Prevention

When adding a new auth teardown path, search for `queryClient.clear()` and ensure every callsite is paired with `AsyncStorage.removeItem(QUERY_CACHE_KEY)`.

## Related Files

- `client/hooks/useAuth.ts` — `logout()`, `expireSession()`, `deleteAccount()` (three teardown paths)
- `client/lib/query-client.ts` — `asyncStoragePersister` definition; `"@ocrecipes_query_cache"` key

## See Also

- [netinfo-isconnected-null-cold-start.md](netinfo-isconnected-null-cold-start-2026-05-13.md) — another cold-launch state pitfall
