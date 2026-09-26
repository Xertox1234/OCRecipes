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

What exists today (`server/routes/auth.ts`): `register`, `login`, `verify-email`, `resend-verification`, `change-email`, `logout`, `me`, `profile`, `DELETE account`, and `POST`/`DELETE /api/user/avatar`. There is no reset or recovery endpoint, and no client screen for one.

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

- [ ] **Password reset:** "Forgot password?" on the login screen. The user enters their email and gets a single-use reset credential with a short lifetime (15–60 minutes).
- [ ] **How the credential reaches the app:** a short code the user types into the app, **or** verified universal/app links. Verified links mean an Apple App Site Association file plus iOS `associated-domains`, and Android `assetlinks.json` plus `autoVerify`. Today neither exists (`app.json` declares only `"scheme": "ocrecipes"`; no `associated-domains` in `ios/`, no `autoVerify` in the Android manifest). **Never put a reset token in a custom-scheme (`ocrecipes://`) URL**, because any installed app can register that scheme and capture it.
- [ ] **Web fallback, if one exists:** the GET page only renders a form; the token is consumed only by a POST. Email link scanners (e.g. Safe Links) prefetch GETs and would burn a GET-consumed token, which is unlike `/verify-email`, which consumes on GET. The page sends `Referrer-Policy: no-referrer` and `frame-ancestors 'none'`, loads no third-party resources, is CSRF-protected, and lives outside `/api` so the request logger never records the token-bearing URL (`docs/solutions/conventions/token-bearing-url-route-must-avoid-request-url-logging-2026-06-22.md`).
- [ ] **No account enumeration:** the reset request gives the same response, with the same awaited work, whether or not the email exists. Generate and hash a token on both branches, send the email fire-and-forget, and apply the per-email rate limit _before_ the account lookup, so the rate-limit response doesn't reveal existence either.
- [ ] **Look up the verified email only:** match the lowercased `email` column, never the staged `pendingEmail`. Otherwise an unverified, staged address could receive a reset link for someone else's account.
- [ ] **After a successful reset:** call both `storage.incrementTokenVersion(userId)` **and** `invalidateTokenVersionCache(userId)`, as logout does. `requireAuth` caches `tokenVersion` for 60s per process (`server/middleware/auth.ts`), so an increment alone leaves stolen sessions alive for up to a minute. Also invalidate every other outstanding reset token (a password-hash fingerprint in the token does this; a stored-token design needs an explicit delete), and email the account a "your password was changed" notice with a way to report it.
- [ ] **An email change** (`change-email`) also invalidates outstanding reset tokens.
- [ ] Decide whether a completed reset marks the email as verified.
- [ ] **Recovering the username:** either login accepts email as well as username, or a "forgot username" email sends it; the user decides. If login accepts email: raise `loginSchema.username`'s `max(30)`, trim and lowercase the input, run a dummy `bcrypt.compare` on the missing-user branch (which fixes related gap 3 instead of widening it), and key `loginAccountLimiter` so both identifiers for one account share a bucket.
- [ ] Rate-limit reset requests per email and per IP.
- [ ] If reset tokens are stored, store only a SHA-256 hash. Either way, never log them.
- [ ] Server and client tests for: happy path, expired token, reused token, unknown email (same response), a `pendingEmail` address (no reset sent), rate limit, and sessions revoked immediately (cache invalidated).
- [ ] Reviewed by `security-auditor` before merge; never auto-merged.
- [ ] Decide separately whether to fix related gaps 2 and 3, or file them.

## Implementation Notes

- The email-verification flow is the closest existing pattern (`server/lib/verification-token.ts`: its own audience, 24h TTL). A reset token, if it's a JWT, must be **distinguishable from an access token**. `requireAuth` accepts any token signed with the shared `JWT_SECRET` that has issuer `ocrecipes-api`, audience `ocrecipes-client`, and passes `isAccessTokenPayload`. So a reset JWT must use its own audience (e.g. `ocrecipes-password-reset`) and a `purpose` claim, pin `algorithms: ["HS256"]`, carry no `tokenVersion` or other access-token-shaped claims, and use a short TTL. Otherwise it could double as a 7-day session. A stateless JWT is only single-use with a stored nonce or a fingerprint of the current password hash; pick one deliberately.
- `docs/solutions/conventions/client-401-session-expiry-gating-and-local-logout-2026-05-30.md` covers the token-revocation codes a reset would reuse.
- The owner's lockout may need a one-off manual recovery (read-only prod lookup of their username) before this ships. Auto mode denies production reads, so that has to be done with the user present.

## Scope Contract

- **Files in scope:** `server/routes/auth.ts`, `server/routes/_schemas.ts`, `server/storage/users.ts`, `shared/schema.ts` (only if a reset-token table or column is chosen), the email templates, `client/screens/LoginScreen.tsx` plus a new reset screen, `client/navigation/linking.ts`, and tests.
- Changes to auth middleware or JWT verification need an explicit security review.

## Dependencies

- Pairs with `P2-2026-09-26-password-length-policy.md`: the reset form should enforce the same password policy.

## Risks

- Auth has broken repeatedly in this codebase (route tests mock the middleware). Test the real middleware path for the new endpoints, not just mocked routes.
- Universal/app links need a hosted AASA/assetlinks file and a new native build (entitlements change), so they can't ship by OTA. A typed code avoids that.

## Updates

### 2026-09-26

- Filed at the user's request (auth parked for a broader review). Hardened after a security-auditor review: code vs custom-scheme links, POST-only token consumption, reset-token audience separation, the 60s token-version cache, verified-email-only lookup, and the change notice. Each code claim was re-checked against `main`.
