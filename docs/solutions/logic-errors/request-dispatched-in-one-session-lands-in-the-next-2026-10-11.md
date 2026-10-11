---
title: "A request started in one session can answer — or be sent — in the next: compare the token it used with the stored one before acting"
track: bug
category: logic-errors
tags: [client-state, security]
module: client
applies_to: ["client/lib/query-client.ts", "client/hooks/useAuth.ts", "client/lib/push-token-registration.ts"]
symptoms: ["Signing in as B right after signing out A shows 'session expired' and drops B to the login screen", "Turning on two-step verification signs you out before the recovery codes appear", "A stale /me response writes the previous user's profile into the new session"]
created: 2026-10-11
severity: low
---

# A request started in one session can answer — or be sent — in the next: compare the token it used with the stored one before acting

## Problem

Auth audit 2026-10-10 L7 (and the H2 review). `apiRequest` / `getQueryFn` read the bearer at SEND time and reported a token-bearing 401 as session death whenever *some* token was attached. Across a token swap — sign-out + sign-in as another user, or the 2FA enable/new-phone `tokenVersion` bump that hands the client a new token — a slow request sent under token A came back `TOKEN_REVOKED` and the SessionExpiryBridge expired session B (on 2FA setup, unmounting the screen before the one-time recovery codes showed). `checkAuth` likewise wrote a stale `/me` profile, or cleared B's token on A's 401.

The mirror case: a request whose DISPATCH is delayed past a session swap (e.g. behind a timeout race) picks up the NEXT session's bearer.

## Root Cause

Session identity was implicit ("whatever token is stored right now") at both ends of an async gap.

## Solution

- `notifyIfSessionExpired(res, sentToken)` fires only if `await tokenStorage.get() === sentToken` — a 401 about an already-ended session is ignored. Covers the offline drain's pinned-token path too.
- `checkAuth` re-reads the token after `/me` and returns without writing anything if it changed (the new session set its own state).
- A capped background request records `timedOut` and skips the send once the cap fires.

## Prevention

Any async auth-adjacent flow: capture the token you act under, and before a side effect (signal, state write, clear, send) check it is still the stored one.

## Related Files

- `client/lib/query-client.ts`, `client/hooks/useAuth.ts`, `client/lib/push-token-registration.ts`

## See Also

- [../conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md](../conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md) — the 401 gating this extends
