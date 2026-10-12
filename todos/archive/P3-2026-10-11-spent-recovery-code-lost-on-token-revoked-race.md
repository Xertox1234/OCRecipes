---
title: "A spent recovery code's replacement is lost when the same request is answered TOKEN_REVOKED (concurrent revocation race)"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, auth, mobile]
github_issue:
---

# Replacement recovery code lost on a TOKEN_REVOKED race

## Summary

If a two-step user spends a recovery code on `POST /api/auth/change-password` and a reset / sign-out-everywhere lands during that request, the server answers 401 `TOKEN_REVOKED` carrying `replacementRecoveryCode`. `apiRequest`'s session-expiry interceptor signs the phone out first, the screen unmounts, and the new code is never shown — the person has one recovery code fewer.

## Background

Found by the security re-review of the change-password app PR (2026-10-11), measured against the real `query-client` module: `401 TOKEN_REVOKED signOutFired=YES replacement=r-1`, control `400 PASSWORD_TOO_SHORT signOutFired=no`. Low: only a concurrent revocation race reaches it (a failed Google/Apple check answers UNAUTHORIZED, not TOKEN_REVOKED), no attacker can trigger it, nothing leaks, and the person can generate a fresh set of recovery codes. Deferred because the fix is in the shared sign-out interceptor, not the screen.

## Acceptance Criteria

- [x] A TOKEN_REVOKED answer that carries `replacementRecoveryCode` shows the code before the sign-out (e.g. card first, `expireSession` on "I've saved it"), or the code survives onto the signed-out screens.
- [x] Regression test at the useAuth / query-client layer (the screen test mocks the context and can't see the interceptor).
- [x] Check other routes that return a replacement code next to TOKEN_REVOKED for the same race.

## Implementation Notes

- `client/lib/query-client.ts` (`notifyIfSessionExpired`, `SESSION_EXPIRY_CODES`), `client/hooks/useAuth.ts` (`changePassword`), `client/screens/ChangePasswordScreen.tsx`.
- Server side for reference: `server/routes/auth-password.ts` (TOKEN_REVOKED + replacement in the `!changed.ok` branch and the `HttpFailure` catch).

## Resolution

Fixed 2026-10-11 (client only; rides the pending production OTA).

- `client/lib/query-client.ts`: the session-expiry interceptor does not fire when the 401 body carries `replacementRecoveryCode` (guard 4). Fail-safe: the token is dead server-side, so if a caller never ends the session, the next authed request is refused by the middleware (no extras) and signs out then.
- `client/hooks/useAuth.ts` `changePassword`: `revokedReplacementOrThrow` (`client/lib/second-factor-utils.ts`) turns TOKEN_REVOKED + replacement into `{ done: true, replacementRecoveryCode, endSession }`. `endSession` fires the normal sign-out (bridge teardown + toast) only if the stored token is still the one that was refused (audit L7).
- `ChangePasswordScreen`: shows the full-screen card (no error beside it), and "I've saved it" calls `endSession` instead of going back.
- Other routes: `TOKEN_REVOKED` is emitted by a route handler only in `server/routes/auth-password.ts` (lines 179, 204). The two-step routes answer a refused session with `MFA_CHALLENGE_EXPIRED` (from `issueSession`), not a session-expiry code, and already hand the codes back via `recoveryCodesOrThrow`.
- Tests: `session-expiry.test.ts` (with/without replacement, real query-client), `useAuth.test.ts` (resolves with code; endSession fires; L7 control; no-replacement still rejects), `ChangePasswordScreen.test.tsx` (card first, Done → endSession, not goBack).
