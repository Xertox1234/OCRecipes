---
title: 'Client 401→logout must gate on session-token codes, clear locally, and never throw'
track: knowledge
category: conventions
module: client
tags: [auth, jwt, session-expiry, '401', query-client, react-native, client-state, security]
applies_to: [client/lib/query-client.ts, client/hooks/useAuth.ts, client/components/SessionExpiryBridge.tsx]
created: '2026-05-30'
---

# Client 401→logout must gate on session-token codes, clear locally, and never throw

## Rule

When a centralized client interceptor turns a `401` into a "session expired" logout, three things MUST hold:

1. **Gate on the session-token error code, not on the bare status.** Fire the logout signal only when the `401` body carries a code the **auth middleware** emits (`TOKEN_EXPIRED` / `TOKEN_INVALID` / `TOKEN_REVOKED` — see `shared/types/auth.ts`). A token-bearing `401` with any other code (or none) is a route-handler rejection, not session death.
2. **The expiry teardown makes NO server call.** The token is already dead; POSTing `/api/auth/logout` with it returns `401` and re-enters the interceptor — an expiry loop. Clear locally only (token + AsyncStorage + query cache + state).
3. **The teardown never throws and always reaches the state-clearing `setState`.** It runs from an out-of-tree event-emitter handler. Wrap *every* cleanup step (including `queryClient.clear()`) so a late throw can't skip the `setState` that is the actual logout.

## Smell patterns

- `if (res.status === 401 && tokenAttached) notifyLogout()` — too broad; logs the user out on a wrong-password `401` from an authenticated endpoint.
- An `expireSession`/logout that calls `apiRequest("POST", "/api/auth/logout")` after a `401`.
- A teardown with one unguarded call (e.g. `queryClient.clear()`) sitting *before* the final `setState`.

## Why

- **`401` is overloaded.** The JWT middleware (`server/middleware/auth.ts`) returns `401` + `TOKEN_*` for a dead token, but route handlers behind `requireAuth` return `401` + `UNAUTHORIZED` for their own reasons — e.g. a wrong confirmation password on `DELETE /api/auth/account` (`server/routes/auth.ts`) or a wrong-password login. Treating *every* token-bearing `401` as session death silently logs out a user who merely mistyped a password. Verified against the real server codes — do not trust a "fire if code absent or session-code" heuristic, because a no-code `401` is also not session death.
- **The loop is real.** A dead token POSTed to `/logout` 401s and re-fires the same interceptor. A local-only teardown is also semantically correct: you don't ask a server to revoke a token it just rejected.
- **Order matters in the teardown.** `queryClient.clear()` placed after the `try/catch` blocks but before `setState` means a throw there skips the logout state transition, leaving the UI "authenticated" with no token. `queryClient.clear()` is sync cache iteration and ~never throws, but the contract ("never throw", "always clear state") must hold regardless.

## Examples

Interceptor chokepoint (`query-client.ts`), called from both `apiRequest` and `getQueryFn` before any status branching:

```ts
const SESSION_EXPIRY_CODES = new Set(["TOKEN_EXPIRED", "TOKEN_INVALID", "TOKEN_REVOKED"]);

async function notifyIfSessionExpired(res: Response, tokenAttached: boolean) {
  if (res.status !== 401 || !tokenAttached) return;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(await res.clone().text()); // clone: leave the caller's body intact
    if (parsed && typeof parsed === "object" && typeof parsed.code === "string") code = parsed.code;
  } catch {}
  if (code && SESSION_EXPIRY_CODES.has(code)) notifySessionExpired();
}
```

Local-only, never-throwing teardown (`useAuth.expireSession`):

```ts
try { await tokenStorage.clear(); } catch {}
try { await AsyncStorage.removeItem(AUTH_STORAGE_KEY); } catch {}
try { queryClient.clear(); } catch {}   // guarded so the setState below always runs
setState({ user: null, isLoading: false, isAuthenticated: false }); // the actual logout
```

## Exceptions

- The proactive bootstrap check (`useAuth.checkAuth` → raw `fetch` to `/api/auth/me`) does not flow through the interceptor; it routes its own `401` through the same `notifySessionExpired()` so a foreground-resume expiry isn't silent. Gate that call on `response.status === 401` (a non-401 `/me` failure is not session death). The bridge's `isAuthenticated` gate keeps a cold-launch expired token silent.
- The user-facing "session expired" toast must be gated on having been authenticated this session (the `SessionExpiryBridge` reads `isAuthenticated`), so a stray `401` during cold launch opens quietly to Login instead of flashing an alarming message.

## Related Files

- `client/lib/query-client.ts` — `subscribeToSessionExpiry`, `notifySessionExpired`, `notifyIfSessionExpired`
- `client/hooks/useAuth.ts` — `expireSession`, `checkAuth` else-branch
- `client/components/SessionExpiryBridge.tsx` — out-of-tree → React bridge
- `server/middleware/auth.ts` / `shared/types/auth.ts` — the canonical `TOKEN_*` code set

## See Also

- [requireauth-middleware-over-manual-checks](requireauth-middleware-over-manual-checks-2026-05-13.md) — the server side that emits the `TOKEN_*` codes
- [error-code-constants-machine-readable](error-code-constants-machine-readable-2026-05-13.md) — why the client can branch on `code`
- [appstate-foreground-auth-recheck-latch](appstate-foreground-auth-recheck-latch-2026-05-30.md) — the foreground re-check that also feeds this signal
- [../design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md](../design-patterns/module-level-emitter-bridge-out-of-tree-to-toast-2026-05-28.md) — the emitter→bridge pattern reused here
- [../logic-errors/post-server-success-local-cleanup-must-not-throw-2026-05-13.md](../logic-errors/post-server-success-local-cleanup-must-not-throw-2026-05-13.md) — the never-throw-on-local-cleanup sibling rule
