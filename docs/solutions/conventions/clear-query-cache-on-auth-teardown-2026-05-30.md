---
title: Clear the TanStack Query cache on every local auth teardown (logout / session-expiry / account-delete)
track: knowledge
category: conventions
module: client
tags: [auth, client-state, query-client, tanstack-query, security, privacy, logout]
applies_to: [client/hooks/useAuth.ts]
created: '2026-05-30'
---

# Clear the TanStack Query cache on every local auth teardown (logout / session-expiry / account-delete)

## Rule

Every path that tears down the local auth session — `logout()`, the 401-driven `expireSession()`, and `deleteAccount()` — must call `queryClient.clear()` (guarded in try/catch) alongside clearing the token and AsyncStorage. If one teardown path clears the cache, they all must: the asymmetry is the bug.

## Smell patterns

- A teardown that clears the token + AsyncStorage but NOT the TanStack Query cache.
- Asymmetry: `expireSession` clears the cache but `logout`/`deleteAccount` don't (or vice-versa).
- `queryClient.clear()` placed before the state-clearing `setState` **without** a try/catch.

## Why

- The TanStack Query cache holds fetched data (profile, nutrition, recipes, daily logs…) in memory keyed by **query key, not by user**. On the same device/app instance, after user A logs out or deletes their account and user B signs in, B's screens can momentarily render A's cached data before refetch — a cross-session / cross-user data leak. `deleteAccount` is the most sensitive: the account is permanently gone, so its data must not linger for the next signer-in.
- **Guard it.** In every teardown the cache-clear sits *before* the `setState` that flips `isAuthenticated` to `false`, and `expireSession` runs from an out-of-tree event handler (`SessionExpiryBridge`) under a contractual "never throw." An unguarded `queryClient.clear()` that threw would skip that `setState`, leaving the UI "authenticated" with no token. `queryClient.clear()` is sync cache iteration and ~never throws, but the contract must hold regardless — wrap it like the token/AsyncStorage clears.

## Examples

```ts
// useAuth.ts — all three teardown paths clear the cache, guarded so setState always runs:
const expireSession = useCallback(async () => {
  try { await tokenStorage.clear(); } catch {}
  try { await AsyncStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
  try { queryClient.clear(); } catch {}
  setState({ user: null, isLoading: false, isAuthenticated: false });
}, []);

// logout(): try { POST /api/auth/logout } catch {} → tokenStorage.clear → removeItem → try { queryClient.clear() } catch {} → setState
// deleteAccount(): await DELETE /api/auth/account → try{tokenStorage.clear}catch → try{removeItem}catch → try{queryClient.clear()}catch → setState
```

## Exceptions

- Auth teardowns always use the blunt `queryClient.clear()` (end the whole session). For **non-auth** flows that just need fresh data, prefer the targeted `queryClient.invalidateQueries` / `removeQueries` instead — `clear()` is only right when the session itself is ending.

## Related Files

- `client/hooks/useAuth.ts` — `logout`, `expireSession`, `deleteAccount`
- `client/lib/query-client.ts` — the shared `queryClient` singleton

## See Also

- [client-401-session-expiry-gating-and-local-logout](client-401-session-expiry-gating-and-local-logout-2026-05-30.md) — the 401→`expireSession` path that established the guarded local teardown
- [../design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md](../design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md) — the bridge that triggers `expireSession` from outside the React tree
