---
title: 'A deferred logout revoke retried in the background can end the same user''s new session'
track: bug
category: logic-errors
module: client
tags: [security, hooks, client-state, auth, race-condition]
applies_to: [client/hooks/useAuth.ts]
symptoms: ["User logs out offline, reconnects, signs back in as the same user, and is signed out again a moment later", "A pending-revoke record is dropped on sign-in, yet a retry already sent still lands"]
created: '2026-11-04'
severity: high
---

# A deferred logout revoke retried in the background can end the same user's new session

## Problem

When a server logout fails (offline, 5xx), the client records a pending revoke and retries it later. Server logout bumps the user's `tokenVersion`, which revokes **every** token that user holds, including tokens issued after the logout was requested. A retry that is already in flight when the same user signs back in reaches the server after the new token was issued, and ends the new session.

## Symptoms

- Signed out again shortly after a successful re-sign-in.
- Only after an offline (or failed) logout, and only for the same user.

## Root Cause

Dropping the pending record in `establishSession` is too late. The server issues the new token before the client stores it, so a retry sent before the drop, or racing it, still bumps `tokenVersion` afterwards. Two-step sign-in widens the window: `finishSignIn` runs after the code check, outside any guard.

## Solution

Make the retry and every sign-in mutually exclusive on this device (`client/hooks/useAuth.ts`, #1732):

- **A sign-in waits for a retry already on the wire.** `withSignInExclusion` awaits `pendingRevokeRun` (which never rejects) before sending the sign-in request.
- **A retry never starts during a sign-in.** `retryPendingRevoke` returns early while `signInsInFlight > 0`.
- **Two-step drops the record as soon as the code passes** (`dropPendingRevokeFor(user.id)` in `verifySecondFactor`).
- Wrap **every** entry point that issues a token: password, two-step code, Google/Apple, social sign-up, and link-with-password/provider. `register` is exempt, because a new account has no pending revoke.

Known gap (owner ruling, 2026-11-04): logging out offline on one device and signing in on **another** can still end the other session when this device's retry lands. Closing that needs a server-side cutoff (revoke only tokens issued before the logout's timestamp).

## Prevention

- Any deferred, retried call that invalidates *all* of a user's credentials must be ordered against every code path that mints a new credential for that user, not just cleaned up after it.
- Test it with a revoke promise held open across a sign-in, and check that the sign-in request is sent only after it settles.

## Related Files

- `client/hooks/useAuth.ts` (`withSignInExclusion`, `retryPendingRevoke`, `verifySecondFactor`)
- `client/hooks/__tests__/useAuth.test.ts` ("pending server revoke after a failed logout")
- `todos/archive/P3-2026-10-30-logout-pending-server-revoke.md`

## See Also

- [revoking-any-apple-token-ends-the-whole-grant](revoking-any-apple-token-ends-the-whole-grant-2026-10-11.md): another revoke whose blast radius is wider than the token named
- [client-401-session-expiry-gating-and-local-logout](../conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md): the local-logout rules this retry sits behind
