---
title: "Cache AsyncStorage Reads in Memory for Hot-Path Values"
track: bug
category: performance-issues
tags: [async-storage, performance, react-native, auth, caching]
module: client
applies_to: ["client/lib/token-storage.ts", "client/lib/**/*.ts"]
symptoms:
  - "Every API request stalls 2–10ms reading the auth token from AsyncStorage"
  - "Rapid requests (e.g., infinite scroll, batch fetch) stutter on slower devices"
  - "Profiling shows AsyncStorage.getItem on the hot path of every request"
created: 2026-05-13
severity: medium
---

# Cache AsyncStorage Reads in Memory for Hot-Path Values

## Problem

Every API request in the initial implementation read the auth token from `AsyncStorage`. Each read costs 2–10ms (depending on device, OS, and AsyncStorage backend). On a screen that fires 10 requests in parallel, that's 20–100ms of pure storage I/O on the request hot path — enough to produce visible stutter, especially on older Android devices.

## Symptoms

- 10 API calls = 20–100ms wasted on storage reads before any network activity begins.
- Stuttering UI when making rapid requests (infinite scroll, prefetch, batch hydration).
- Poor experience on slower devices; harder to spot on flagships.

## Root Cause

`AsyncStorage.getItem` is asynchronous because the underlying storage is backed by SQLite (Android) or a serialized file (iOS). Each call crosses the JS-native bridge. The cost is small per-call but unbounded with frequency, and the auth token is read on **every** outbound request.

The token is also effectively immutable for the lifetime of an app session — it changes only on login, logout, or refresh, all of which are mediated through a single `tokenStorage` module. There is no reason for every consumer to repeatedly cross the bridge to fetch the same string.

## Solution

In-memory cache with lazy initialization. The cache populates on the first read; every subsequent read returns the cached value synchronously (still inside an `async` function for API compatibility, but no bridge hop).

```typescript
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
      cacheInitialized = true;
    }
    return cachedToken; // instant on subsequent calls
  },

  async set(token: string): Promise<void> {
    cachedToken = token;
    cacheInitialized = true;
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    cachedToken = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(TOKEN_KEY);
  },
};
```

The cache invariants:

- Initialized flag is set the first time we read OR write. After that, the in-memory value is always authoritative.
- `set` and `clear` update the cache **before** awaiting storage so a subsequent `get` (e.g., from a concurrent request) sees the new value immediately.
- Crash / cold-start re-reads from disk via the `!cacheInitialized` branch.

**Performance gain:** First call takes 2–10ms; all subsequent calls take <1ms.

## Prevention

- Apply this pattern to **any AsyncStorage value read on a hot path** — auth tokens, feature flags, user preferences, locale.
- Do not apply it to values that change frequently or are large (e.g., cached responses) — those should use a proper LRU cache or stay in TanStack Query.
- Keep the mutation API the only writer: every `set`/`clear` keeps the cache and disk in sync. Never write directly to `AsyncStorage.setItem(TOKEN_KEY, ...)` from outside the module.

## Related Files

- `client/lib/token-storage.ts` — token persistence with caching

## See Also

- [../design-patterns/jwt-over-cookies-react-native-2026-05-13.md](../design-patterns/jwt-over-cookies-react-native-2026-05-13.md) — JWT auth flow that depends on this cache for fast request signing.
