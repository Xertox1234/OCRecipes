---
title: "No password reset or account recovery — a user who forgets their username or password is locked out for good"
status: backlog
priority: high
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# No password reset or account recovery — a user who forgets their username or password is locked out for good

## Summary

OCRecipes has no "forgot password" and no "forgot username" flow. Login accepts a username only. A user who forgets either one can't get back into their account, and there is nothing they can do themselves. The owner is locked out of their own verified production account right now because of this.

## Background

Parked by the user on 2026-09-26, together with a broader review of the app's authentication, to be done as human-led work (auth is high-risk here; don't delegate it to an executor).

What exists today (`server/routes/auth.ts`): `register`, `login`, `verify-email`, `resend-verification`, `change-email`, `logout`, `me`, `profile`, and `DELETE account`. There is no reset or recovery endpoint, and no client screen for one.

The lockout (2026-09-25, preview build 5 against `api.ocrecipes.com`):

- The account exists and is verified. Signing up again with the same email sent "Someone tried to sign up with your email".
- Login does an exact username match (`server/storage/users.ts` `getUserByUsernameForAuth`), with no email lookup. The 401s were fast (60–72 ms, before bcrypt), which suggests the username wasn't found; the email or a variant was probably typed into the username field. That is inferred, not proven.
- The user doesn't remember the exact username.
- Email delivery works in production (Resend; `RESEND_API_KEY` set, and verification mail arrives).

Related gaps found at the same time:

1. Login takes a username only, not an email.
2. The "someone tried to sign up" email doesn't include the username.
3. A missing-user login returns faster than a wrong-password one (username enumeration by timing), even though register deliberately equalizes its timing.

## Acceptance Criteria

- [ ] **Password reset:** "Forgot password?" on the login screen. The user enters their email and gets a single-use, short-lived reset link or code. Setting a new password invalidates the token and signs out existing sessions (token revocation is already supported for session expiry).
- [ ] **No account enumeration:** the reset request returns the same response and similar timing whether or not the email exists.
- [ ] **Recovering the username:** either login accepts email as well as username, or a "forgot username" email sends it. The user decides which (email login is probably the simpler fix, and it unblocks the owner's lockout).
- [ ] Rate-limit reset requests per email and per IP.
- [ ] Reset tokens are stored hashed, never in plain text, and never logged.
- [ ] Deep link: the reset link opens the app's reset screen (`client/navigation/linking.ts`); there's also a web fallback, or the flow uses a code instead of a link.
- [ ] Server and client tests for: happy path, expired token, reused token, unknown email (same response), and rate limit.
- [ ] Reviewed by `security-auditor` before merge; never auto-merged.
- [ ] Decide separately whether to fix related gaps 2 and 3, or file them.

## Implementation Notes

- The email-verification flow is the closest existing pattern: a stateless JWT token, Resend delivery, and a `/verify-email` landing route. A reset token must be single-use, though, and a stateless JWT isn't single-use without a stored nonce or a hash of the current password hash. Pick one deliberately.
- `docs/solutions/conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md` covers the token-revocation codes a reset would reuse.
- The owner's lockout may need a one-off manual recovery (read-only prod lookup of their username) before this ships. Auto mode denies production reads, so that has to be done with the user present.

## Scope Contract

- **Files in scope:** `server/routes/auth.ts`, `server/routes/_schemas.ts`, `server/storage/users.ts`, `shared/schema.ts` (only if a reset-token table or column is chosen), the email templates, `client/screens/LoginScreen.tsx` plus a new reset screen, `client/navigation/linking.ts`, and tests.
- Changes to auth middleware or JWT verification need an explicit security review.

## Dependencies

- Pairs with `P2-2026-09-26-password-length-policy.md`: the reset form should enforce the same password policy.
