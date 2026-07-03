---
title: A durable client write-queue not cleared on auth teardown replays one user's writes under the next
track: bug
category: logic-errors
module: client
severity: high
tags: [auth, offline, async-storage, multi-account, privacy, data-integrity, logout, tanstack-query]
symptoms: ['On a shared device, user B sees user A''s scanned items / data appear seconds after signing in', An account-delete is silently undone — the "erased" data reappears under whoever signs in next, A queued offline mutation POSTs/DELETEs under the wrong account after a logout + re-login]
applies_to: [client/hooks/useAuth.ts, client/lib/offline-queue.ts, client/lib/offline-queue-drain.ts]
created: '2026-06-19'
---

# A durable client write-queue not cleared on auth teardown replays one user's writes under the next

## Problem

A durable offline mutation queue (AsyncStorage-backed, drained on reconnect)
persisted across **all** auth teardown paths because its `clearOfflineQueue()`
helper existed but was **never wired in**. The queue key was a single global
string (no per-user namespace) and the drain attaches the **current** bearer
token at replay time, not the token of the user who enqueued. Result: user A's
queued writes replay authenticated as user B.

## Symptoms

- Shared/family/demo device: A logs food offline → A logs out → B signs in →
  next reconnect fires the drain → A's `POST /api/scanned-items` lands in **B's**
  diary.
- `deleteAccount`: A's queued writes survive the deletion and re-create the
  "erased" data under the next user.
- Invisible in single-account testing — only emerges across an account switch.

## Root Cause

`logout` / `expireSession` / `deleteAccount` each cleared the auth blob **and**
the persisted TanStack Query cache (`queryClient.clear()` + remove the cache
key), but none cleared the offline write queue. `clearOfflineQueue` was a dead
export (zero callers). The query cache is a **read** leak; the un-cleared write
queue is far worse — an authenticated **write** replay under the wrong identity.

## Solution

Clear the durable write-queue on **every** teardown path, alongside the query
cache, and put it **first** in the guarded block so it can't be skipped:

```ts
// useAuth: logout / expireSession / deleteAccount
try {
  await clearOfflineQueue();           // FIRST — it swallows its own errors, can't throw
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  queryClient.clear();
} catch {}
setState({ user: null, isLoading: false, isAuthenticated: false });
```

`clearOfflineQueue` must reset BOTH the in-memory array and the persisted key:

```ts
export async function clearOfflineQueue(): Promise<void> {
  queue = [];
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
```

Assert it in the test for all three teardown paths (mock the module, assert the
spy was called) — the same way the query-cache clear is asserted.

## Prevention

- **Any** durable, replayed-later client store that carries user data (offline
  mutation queue, draft cache, pending-upload list) must be cleared on logout,
  session-expiry, AND account-delete — enumerate all teardown paths, not just
  `logout`. A global (non-namespaced) key + a token attached at replay time is a
  cross-account contamination vector.
- A residual narrow window remains if a drain is already in flight during the
  teardown (it replays its captured request under the new token); the durable
  fix is an auth gate on the drain itself — track it as a follow-up.
- Treat a `clear*` helper with **zero callers** as a red flag during review, not
  as dead code to delete.

## Related Files

- `client/hooks/useAuth.ts` — `logout`, `expireSession`, `deleteAccount` (the three teardown paths)
- `client/lib/offline-queue.ts` — `clearOfflineQueue` (was the dead export)
- `client/lib/offline-queue-drain.ts` — `drainQueue` attaches the current token at replay

## See Also

- [Offline persistence reliability gotchas](../best-practices/offline-persistence-reliability-gotchas-2026-06-19.md) — sibling findings from the same offline feature
