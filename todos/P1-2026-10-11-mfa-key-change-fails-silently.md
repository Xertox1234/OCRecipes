---
title: "Replacing MFA_SECRET_ENC_KEY silently breaks every authenticator: catch a key that can't read the stored secrets"
status: backlog
priority: high
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, auth, security]
github_issue:
human_led: true
blocked_reason: "Owner ruling needed (refuse to start vs. run degraded; option a vs. b). Auth crypto: implement in-session, never delegate."
---

# A changed MFA key breaks every authenticator without warning

## Summary

If `MFA_SECRET_ENC_KEY` is replaced, every stored authenticator secret becomes unreadable. Nothing warns at deploy time. The first sign is a person seeing "Two-step verification is unavailable" at their next code check, and by then the old key may be gone for good. Make a wrong key show up at deploy, and leave a trail that says when the key changed.

## Background

Incident 2026-10-11/12 (owner's own account):

- Two-step was set up 2026-10-10 21:48Z and three code checks passed by 21:54Z.
- On 2026-10-12, Change password answered 503 `MFA_UNAVAILABLE`. The server logged "MFA secret unavailable" (`verify-second-factor.ts`).
- Read-only diagnostic: the stored blob is intact (`v1`, 12B iv, 16B tag, 32B ct). The current key (sha256 fingerprint `8f712603`) fails with a GCM auth error. The same value is in Railway and in the owner's Passwords app.
- No code path or local process re-encrypted the secret (local `.env` has no key). So the Railway key was regenerated after 21:54Z, probably at the same-commit redeploys 2026-10-11 17:28Z/17:32Z, and the old value was not kept.
- Railway exposes no variable history, so this could not be proven, only inferred.
- The startup check (`server/lib/env.ts`) only confirms the key is 32 bytes, and any new key passes it.
- Recovery for the owner: "Set up on a new phone" with password + recovery code.

The app has no other users today, so the damage was one account. With real users, a key change would strand every two-step account on recovery codes.

`IDENTITY_TOKEN_ENC_KEY` (Apple refresh tokens, `token-crypto.ts`) has the same failure mode. A changed key means stored Apple tokens can no longer be revoked.

## Acceptance Criteria

- [ ] At startup, the server checks the configured `MFA_SECRET_ENC_KEY` against stored data. When stored secrets exist and the key cannot decrypt them, it fails loudly: an error log + Sentry event at minimum. The owner decides between refusing to start and running degraded; record the ruling here.
- [ ] Same check for `IDENTITY_TOKEN_ENC_KEY` against stored Apple refresh tokens.
- [ ] Each boot logs a non-secret key fingerprint (first 8 hex of sha256) for both keys, so a key change shows up in the logs with a timestamp.
- [ ] Tests: right key → passes; wrong key → the loud failure fires; no stored secrets → passes (a fresh database must still boot).
- [ ] The runbook says the key must never be regenerated in place, and how to rotate it safely (re-encrypt every row under the new key, then switch).

## Implementation Notes

- Two ways to check the key:
  - **(a)** Sample one existing `user_mfa.totp_secret_enc` row and try to decrypt it. No migration, but a fresh database has nothing to check.
  - **(b)** A stored canary: a known plaintext encrypted with the key in a one-row table. Needs a migration, but checks even with zero users.
  - Recommend (a) plus the fingerprint log unless the owner prefers (b).
- Fingerprint: `crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 8)`, which reveals nothing usable about the key.
- Relevant code: `server/lib/mfa/mfa-secrets.ts` (`loadMfaKey`, `decryptMfaSecret`), `server/lib/social-identity/token-crypto.ts` (`decryptToken`), `server/lib/env.ts` (boot validation), `server/lib/mfa/verify-second-factor.ts` (where the failure surfaces today).
- Runbook: `docs/runbooks/mfa-manual-reset.md` or a new key-handling runbook.
- AUTH IS HIGH-RISK: implement in-session, never delegate, and send it to security-auditor review.

## Scope Contract

- **Mechanisms to use:** a boot-time decrypt check + a log line; option (b) only on an explicit owner ruling.
- **Files in scope:** `server/lib/mfa/mfa-secrets.ts`, `server/lib/social-identity/token-crypto.ts`, `server/index.ts` (or wherever boot checks run), their `__tests__/`, one runbook file. Plus a migration + `shared/schema.ts` only if (b) is chosen.
- No changes to how secrets are encrypted or to the verify paths.

## Dependencies

- Owner ruling: refuse to start vs. run degraded; (a) vs. (b).

## Risks

- Refusing to start on a mismatch takes the whole API down for a two-step problem. Running degraded keeps it up but can go unnoticed. Hence the owner ruling.
- A sample row could be a legitimately orphaned leftover. The check should look at more than one row before declaring the key wrong.

## Updates

### 2026-10-11

- Filed after the 2026-10-12 owner-account incident (owner asked for it).
