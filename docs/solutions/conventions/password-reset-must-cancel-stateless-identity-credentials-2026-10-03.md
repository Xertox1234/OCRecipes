---
title: A password reset must also cancel outstanding credentials that tokenVersion cannot reach — a staged change-email link is a 24 h JWT with no tokenVersion
track: knowledge
category: conventions
tags: [security, api, database, jwt, password-reset, token-versioning, account-recovery]
module: server
applies_to: ["server/routes/auth.ts", "server/storage/password-reset.ts", "server/storage/users.ts", "server/lib/verification-token.ts"]
created: 2026-10-03
---

# A password reset must also cancel outstanding credentials that tokenVersion cannot reach — a staged change-email link is a 24 h JWT with no tokenVersion

## Rule

When a credential-recovery or credential-change event commits (password reset, and later MFA reset or account recovery), it must cancel **every** outstanding credential that can change the account's identity, not only the sessions. `token_version + 1` plus `invalidateTokenVersionCache(userId)` revokes access tokens. It does **not** reach stateless tokens that never carried `tokenVersion`. In this repo that is the change-email verification link: a 24 h JWT whose only check is "does the token's email match the staged `pending_email`".

So the reset's single UPDATE also sets `pending_email = NULL` (and clears the reset code), in the same statement as the password and `token_version` change:

```ts
// server/storage/password-reset.ts — completePasswordReset
.set({
  password: newPasswordHash,
  tokenVersion: sql`${users.tokenVersion} + 1`, // + invalidateTokenVersionCache in the route
  emailVerified: true,
  pendingEmail: null,            // ← kills an outstanding change-email link
  ...CLEARED_RESET_CODE,
})
.where(and(eq(users.id, userId), eq(users.resetCodeHash, matchedHash)))
```

## Why

The attack this closes: an attacker who knows the victim's password stages their own address with `change-email`. The verification link goes to the attacker's inbox. The victim notices and resets the password, which revokes every session. But the change-email JWT is still valid. If `pending_email` survived the reset, the attacker could click the link afterwards, `applyEmailVerification` branch 2 would commit the attacker's address as the verified `email`, and the account would be taken over through the very flow meant to recover it.

`tokenVersion` revocation is shaped like "kill every token", which makes it easy to assume it covers this. It covers exactly the tokens whose verification reads `tokenVersion`. Any credential checked against **row state** (a staged column, a stored code, a nonce) is cancelled by clearing that state, and that has to be listed explicitly.

## Examples

- `server/storage/users.ts` — the two commit points of an email change (`applyEmailVerification` branch 2, `updateUserEmail`) clear a live reset code: once the verified address moves, a code mailed to the old address must die. *Staging* (`stagePendingEmail`) does not clear it, because the verified address hasn't changed.
- `server/storage/__tests__/users-password-reset.test.ts` — "cancels a staged email change: the old change link then updates 0 rows" stages an address, completes a reset, then calls `applyEmailVerification(id, stagedAddress)` and asserts `undefined` with `email` unchanged.
- `server/routes/__tests__/auth-reset-revocation.test.ts` — the session half, run through the **real** `requireAuth`. Positive control: comment out `invalidateTokenVersionCache` and the old token's next `/me` returns 200.

## Exceptions

- A credential that cannot change identity (e.g. a read-only share link) doesn't need to die on a reset. Make that call deliberately and record it.
- Inventory before you add a new stateless token type. If it can change identity and doesn't carry `tokenVersion`, the reset, account deletion and logout-everywhere paths each need an explicit clear.

## Related Files

- `server/storage/password-reset.ts` — `completePasswordReset`, `CLEARED_RESET_CODE`
- `server/storage/users.ts` — `applyEmailVerification`, `updateUserEmail`, `stagePendingEmail`
- `server/lib/verification-token.ts` — the 24 h change-email/verify JWT (no `tokenVersion` claim)
- `server/middleware/auth.ts` — `invalidateTokenVersionCache` (60 s per-process cache)

## See Also

- [token-versioning-jwt-revocation](../design-patterns/token-versioning-jwt-revocation-2026-05-13.md) — the session-revocation half this rule extends
- [security-caps-must-be-durable-and-say-which-window](security-caps-must-be-durable-and-say-which-window-2026-10-03.md) — the reset's issuance and guess caps
- [security-mail-needs-its-own-send-bucket](security-mail-needs-its-own-send-bucket-2026-10-03.md) — the reset code and change notice must still send under a flood
