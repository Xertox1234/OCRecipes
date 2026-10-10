---
title: "On a two-step account every PASSWORD proof needs the code — check it after the password and before any write; a challenge is a DB row answered 200"
track: knowledge
category: conventions
tags: [security, api, architecture]
module: server
applies_to: ["server/routes/auth*.ts", "server/lib/mfa/**", "server/lib/social-identity/**"]
created: 2026-10-10
---

# On a two-step account every PASSWORD proof needs the code — check it after the password and before any write; a challenge is a DB row answered 200

## Rule

1. **Signed-in password proofs.** Any signed-in route that accepts a password as proof of identity calls `secondFactorForPasswordProof(user, proofIsPassword, secondFactor)` **after** the password check succeeds and **before** any write. Today that's change email, delete account, and connect a sign-in method.
   - **No code:** `403 SECOND_FACTOR_REQUIRED`.
   - **Wrong code:** `401 INVALID_SECOND_FACTOR`.
   - **Unreadable secret:** `503 MFA_UNAVAILABLE`.
   - **A Google/Apple proof never needs it** (owner ruling D1, 2026-10-10).
2. **Signed-out sign-in.** A password sign-in, or a password link at the Connect prompt, on a two-step account gets a **challenge**: an opaque random token stored only as a hash, single-use, bound to `users.token_version`, never a JWT. The response is **HTTP 200** `{ status: "mfa_required", challenge }`, never a 4xx.
3. **Order on routes that also take a provider token.** Run the gate **before** spending the provider nonce, so the retry after `SECOND_FACTOR_REQUIRED` can reuse the same token.

## Why

- **After the password check:** otherwise `SECOND_FACTOR_REQUIRED` tells someone without the password that the account has two-step on.
- **Before any write:** a password alone must never change an MFA account. That includes attaching the attacker's own Google account as a permanent bypass.
- **200, not 4xx:** `loginAccountLimiter` uses `skipSuccessfulRequests`. A 4xx would count a **correct** password as a failed login and lock out the real owner.
- **A DB row, not a JWT:** `requireAuth` only ever accepts JWTs, so a leaked challenge can't act as a session. The `tokenVersion` binding means a password reset kills open challenges for free. The real-database itest asserts both, including that the real `requireAuth` refuses a challenge.

## Examples

- `server/lib/mfa/password-proof-gate.ts` — the one helper all three routes call
- `server/lib/mfa/challenge.ts` (`startMfaChallenge`), and the login branch in `server/routes/auth.ts`
- `server/routes/auth-mfa.ts` `POST /api/auth/mfa/verify` — a dead challenge (expired, spent, out of attempts, `tokenVersion` moved) answers `401 MFA_CHALLENGE_EXPIRED`
- `test/integration/auth-routes.itest.ts` — the end-to-end journey

## Exceptions

- **Password reset** needs no factor and never clears two-step verification (owner ruling D7). It forgets trusted phones in the same transaction, and its `tokenVersion` bump kills open challenges.
- **A trusted phone** (90 days, survives sign-out) skips the sign-in challenge only. Signed-in password proofs still need the code.

## Related Files

- `server/lib/mfa/**`, `server/routes/auth.ts`, `server/routes/auth-social.ts`, `server/routes/auth-mfa.ts`, `server/routes/__tests__/auth-route-wiring.test.ts` (the public verify route is allow-listed)

## See Also

- [A spent single-use credential's replacement must ride every later response](../logic-errors/spent-single-use-credential-replacement-lost-on-error-paths-2026-10-10.md)
- [Password reset must cancel stateless identity credentials](password-reset-must-cancel-stateless-identity-credentials-2026-10-03.md)
