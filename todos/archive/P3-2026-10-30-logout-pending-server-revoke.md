---
title: "Retry a failed server logout (pending revoke) instead of only logging it"
status: done
priority: low
created: 2026-10-30
updated: 2026-11-04
assignee:
labels: [deferred, reliability, auth]
github_issue:
human_led: true
---

# Retry a failed server logout (pending revoke) instead of only logging it

## Summary

`logout()` in `client/hooks/useAuth.ts` clears local state even when
`POST /api/auth/logout` fails (offline, 5xx). Since reliability audit R25 the
failure is logged (`logger.error`), but the JWT is still never revoked
server-side and stays usable until it expires.

## Background

Reliability audit 2026-10-30, finding R25 (Low, auth, human-in-the-loop).
The minimum fix (make the failure visible) shipped in the iap-auth PR. The full
fix, a durable "pending revoke" that is retried later, was deferred because it
needs a security decision: it means keeping a signed-out user's credential (or
a revocation handle) on the device after sign-out, which the current design
deliberately avoids (`tokenStorage.clear()` on every session-ending path).

## Acceptance Criteria

- [x] Decide what is persisted for a later revoke (the old token in SecureStore, or a server-issued revocation handle) and confirm it with the owner.
- [x] A failed server logout records a pending revoke; the next app start / reconnect retries it and clears the record on success.
- [x] A pending revoke never attaches to, or revokes, the NEXT signed-in user's session on this device (another device: see the 2026-11-04 owner ruling below).
- [x] Tests cover offline logout, retry success, retry failure, and sign-in of another user before the retry.

## Implementation Notes

- `client/hooks/useAuth.ts` `logout()` (the `catch` after `apiRequest("POST", "/api/auth/logout")`).
- The push-token DELETE (`unregisterPushToken`, 3 s cap) has the same best-effort gap; the server-side alternative is an expiry on stale push-token rows.
- Server side alternative: shorter token lifetime or refresh-token rotation makes the gap smaller without client storage.

## Scope Contract

- **Mechanisms to use:** existing `tokenStorage` / SecureStore and the existing logout endpoint.
- **Files in scope:** `client/hooks/useAuth.ts`, `client/lib/token-storage.ts`, their `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Owner decision on persisting a credential after sign-out (auth is never-delegate).

## Risks

- Storing a credential after sign-out widens the window it can leak on a shared device.

## Updates

### 2026-10-30

- Initial creation (deferred remainder of reliability audit R25).

### 2026-11-04

- Owner overrode the human_led hold for this run (remote session, after seeing the gate reason).
- Persisted: the OLD session token + its user id, under its own Keychain entry (`pendingRevokeStorage`, same `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` options as the session token), until a retry revokes it (2xx) or the server says it is already dead (401). A server-issued revocation handle would need a new endpoint (out of the scope contract).
- The server logout bumps tokenVersion (revokes every token of that user), so a retry is never sent while the same user is signed in again: that user's record is dropped at sign-in and at retry time.
- Retries: once the session state is known at launch, on every signed-in-user change, and when the app returns from the background. Plain fetch with the old token, never apiRequest.
- Review round 1 (code-reviewer + security-auditor) found a retry already on the wire could land after the same user signed back in and end the new session — the server issues the token before the record is dropped. Fixed: a sign-in waits out a running retry, a retry never starts during a sign-in, and a two-step sign-in drops the record as soon as the code passes.
- Owner ruling (after review): the other-device case is ACCEPTED, not fixed. A user who logs out offline on this phone and then signs in on another device is signed out there when this phone's retry lands — as if the logout had succeeded late. Closing it needs a server-side cutoff (revoke only tokens issued before the failed logout); a separate change if ever wanted.
