---
title: "Check-then-act on auth state needs the check inside the write — a predicate on the UPDATE, or a row lock in one transaction"
track: knowledge
category: design-patterns
tags: [database, security]
module: server
applies_to: ["server/storage/mfa.ts", "server/storage/identities.ts", "server/storage/push-tokens.ts", "server/routes/auth*.ts"]
created: 2026-10-11
---

# Check-then-act on auth state needs the check inside the write — a predicate on the UPDATE, or a row lock in one transaction

## Rule

When a route reads an auth fact (locked? 2FA on? last sign-in method? token version?) and later writes based on it, the fact must be re-checked by the write itself:

- **Single-row counter/flag:** put the predicate in the `UPDATE … WHERE` (e.g. `recordMfaFailure` carries `notLocked`).
- **Cross-row invariant** ("not the last identity"): `SELECT … FOR UPDATE` the owning `users` row in a transaction, then count, then write. A bare `DELETE … WHERE (SELECT count(*)) > 1` still write-skews under READ COMMITTED — two concurrent statements each see the other's row.
- **Read-then-mint:** check on the same read you mint from (`issueSession(userId, expectedTokenVersion)`).

## Why

Auth audit 2026-10-10 found four: L10 (a burst of wrong 2FA codes raced the 100-failure cap in one go — a reviewer measured 30 parallel sessions: 30 without the predicate, 10 with), L13 (setup staged a secret on an account that had just turned 2FA on), L16 (two concurrent disconnects removed every sign-in method), L12 (a session minted at the version current after a reset). The paths the 2FA design marked critical — accepting a TOTP step, spending a recovery code — already did the check in the write, which is why they held.

## Examples

- `server/storage/mfa.ts` — `recordMfaFailure`, `getPendingTotpSecret` (`notLocked`); `startTotpEnrollment(userId, enc, { mfaEnabled })` with `users` FOR UPDATE (required arg, so every call site states its expectation).
- `server/storage/identities.ts` — `deleteIdentity`.

## Exceptions

Lock order: when two transactions take `users` and a child row in opposite orders (`startTotpEnrollment` vs `confirmTotpEnrollment`), a rare pair deadlock-aborts one request. Acceptable when the abort is fail-safe (nothing staged wrongly) — document it at the function.

## Related Files

- `server/storage/mfa.ts`, `server/storage/identities.ts`, `server/routes/auth-social.ts`

## See Also

- [../logic-errors/toggle-favourite-race-condition-2026-05-13.md](../logic-errors/toggle-favourite-race-condition-2026-05-13.md)
