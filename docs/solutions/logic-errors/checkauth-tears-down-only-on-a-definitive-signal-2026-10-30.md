---
title: "checkAuth tears a session down only on a definitive signal — a 401 or a confirmed-absent token; a 5xx/429 or a failed Keychain read resumes from cache"
track: bug
category: logic-errors
tags: [client-state, hooks, auth, session-expiry, keychain, offline]
module: client
applies_to: ["client/hooks/useAuth.ts", "client/lib/token-storage.ts"]
symptoms: ["Users are signed out (and lose queued offline writes) during a server deploy or a 429 burst", "A cold launch right after a device unlock sometimes lands on Login with the token still in the Keychain", "Offline-queued meal logs vanish after a launch that hit a 5xx on /api/auth/me"]
created: 2026-10-30
severity: high
---

# checkAuth tears a session down only on a definitive signal

## Problem

`checkAuth` treated two ambiguous signals as proof the session was gone. Both led to the full teardown: token clear, cached-user removal, and the durable sweep (offline write queue, query cache, drafts).

1. **Any non-OK `/api/auth/me` status.** A 5xx during a deploy, a 429, a 408 or a 403 cleared the token and swept un-drained offline writes. The server rejects a dead token **only** with 401 (`server/middleware/auth.ts`).
2. **A failed SecureStore/Keychain read.** `tokenStorage.get()` caught the read error and returned `null`, the same value as "no token stored". A launch racing the device lock (an item that is unavailable before first unlock) became a sign-out plus a sweep. The token was still in the Keychain.

## Symptoms

- Random sign-outs clustered around deploys or rate-limit spikes.
- Offline-logged items lost after such a launch. This is worse than the sign-out, because the sweep is irreversible.

## Root Cause

An irreversible action (the durable sweep) was gated on an absence that could be either confirmed or caused by an error. Mapping "read failed" to `null` erased the distinction at the lowest layer, so no caller could recover it.

## Solution

- Only `response.status === 401` (routed through `notifySessionExpired`) and a confirmed-null token reach the teardown. Every other non-OK status calls `setState(await resumeFromCachedProfile())`: keep the token and durable state and resume from the cached user. This is the path a network error already took. The helper is module-level and returns the next state rather than throwing into the catch, because React Compiler skips a function that throws inside a `try` (#1622 landed the 401-only half of this fix the same way). The next foreground re-check, or any 401 caught by the query interceptor, re-validates.
- `tokenStorage.getOrThrow()` shares `get()`'s single in-flight read and cache, but **rejects** on a read failure. `SecureStore` resolves `null` only when no entry exists. The in-flight promise settles as `{ token } | { error }` and never rejects, so `set()`/`clear()` can still safely wait on it, and `get()` keeps answering `null` for existing callers. A failed read is not cached, so the next call retries.
- `checkAuth` retries the read once. If it fails again, it calls `resumeFromCachedProfile()`, with **no** durable sweep and **no** token clear.

## Prevention

- Before an irreversible teardown, ask whether the triggering signal is definitive or merely failed to answer. Ambiguous signals (5xx, 429, timeouts, storage read errors) resume or retry. They never sweep.
- A storage wrapper that maps errors to "absent" needs a throwing variant for callers that make destructive decisions. Do not change the lenient one, because other callers depend on it.
- Tests: `/me` answering 500/429/408/403 keeps the token and skips the sweep. A `getItemAsync` rejection twice skips both the token clear and the sweep. A 401 still tears down.

## Related Files

- `client/hooks/useAuth.ts`: `checkAuth`, `resumeFromCachedProfile`.
- `client/lib/token-storage.ts`: `readToken`, `getOrThrow`.
- `client/hooks/__tests__/useAuth.test.ts`, `client/lib/__tests__/token-storage.test.ts`.

## See Also

- [../conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md](../conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md): which 401s count as session death.
- [durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md](durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md): why the sweep exists, and why it must not fire spuriously.
