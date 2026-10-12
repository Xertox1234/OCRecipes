---
title: "Replacing IDENTITY_TOKEN_ENC_KEY silently breaks Apple token revocation: catch a key that can't read the stored tokens"
status: backlog
priority: high
created: 2026-10-11
updated: 2026-10-12
assignee:
labels: [deferred, auth, security]
github_issue:
human_led: true
blocked_reason: "Owner ruling needed (refuse to start vs. run degraded). Auth crypto: implement in-session, never delegate."
---

# A changed identity-token key breaks Apple token revocation without warning

## Summary

If `IDENTITY_TOKEN_ENC_KEY` is replaced, every stored Apple refresh token becomes unreadable. Nothing warns at deploy time. The first sign is a failed revoke at account deletion or disconnect, and by then the old key may be gone for good. Make a wrong key show up at deploy, and leave a trail that says when the key changed.

## Background

This todo began with `MFA_SECRET_ENC_KEY`. On 2026-10-11/12 a replaced key made the owner's own authenticator secret unreadable, and two-step answered 503 `MFA_UNAVAILABLE`. That key no longer exists. Two-step is now an emailed code (owner ruling 4, 2026-10-12), and authenticator apps were removed in the "remove authenticator apps" PR.

`IDENTITY_TOKEN_ENC_KEY` (`server/lib/social-identity/token-crypto.ts`) has the same failure mode, so that half stays open:

- The startup check (`server/lib/env.ts`) only confirms the key is 32 bytes, and any new key passes it.
- Railway exposes no variable history, so a key change can only be inferred after the fact.

Priority is kept from the original todo; the owner may lower it now that the two-step half is gone.

## Acceptance Criteria

- [ ] At startup, the server checks the configured `IDENTITY_TOKEN_ENC_KEY` against stored Apple refresh tokens. When stored tokens exist and the key cannot decrypt them, it fails loudly: an error log + Sentry event at minimum. The owner decides between refusing to start and running degraded; record the ruling here.
- [ ] Each boot logs a non-secret key fingerprint (first 8 hex of sha256), so a key change shows up in the logs with a timestamp.
- [ ] Tests: right key → passes; wrong key → the loud failure fires; no stored tokens → passes (a fresh database must still boot).
- [ ] The runbook says the key must never be regenerated in place, and how to rotate it safely (re-encrypt every row under the new key, then switch).

## Implementation Notes

- Check: sample one stored Apple refresh token and try to decrypt it. A fresh database has nothing to check, which passes.
- Fingerprint: `crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 8)`, which reveals nothing usable about the key.
- Relevant code: `server/lib/social-identity/token-crypto.ts` (`decryptToken`), `server/lib/env.ts` (boot validation).
- AUTH IS HIGH-RISK: implement in-session, never delegate, and send it to security-auditor review.

## Scope Contract

- **Mechanisms to use:** a boot-time decrypt check + a log line.
- **Files in scope:** `server/lib/social-identity/token-crypto.ts`, `server/index.ts` (or wherever boot checks run), their `__tests__/`, one runbook file.
- No changes to how tokens are encrypted or to the revoke paths.
