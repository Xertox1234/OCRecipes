---
title: "A spent recovery code's replacement is lost when the same request is answered TOKEN_REVOKED (concurrent revocation race)"
status: backlog
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

- [ ] A TOKEN_REVOKED answer that carries `replacementRecoveryCode` shows the code before the sign-out (e.g. card first, `expireSession` on "I've saved it"), or the code survives onto the signed-out screens.
- [ ] Regression test at the useAuth / query-client layer (the screen test mocks the context and can't see the interceptor).
- [ ] Check other routes that return a replacement code next to TOKEN_REVOKED for the same race.

## Implementation Notes

- `client/lib/query-client.ts` (`notifyIfSessionExpired`, `SESSION_EXPIRY_CODES`), `client/hooks/useAuth.ts` (`changePassword`), `client/screens/ChangePasswordScreen.tsx`.
- Server side for reference: `server/routes/auth-password.ts` (TOKEN_REVOKED + replacement in the `!changed.ok` branch and the `HttpFailure` catch).
