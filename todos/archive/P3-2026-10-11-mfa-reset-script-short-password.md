---
title: "Manual 2FA reset must not leave a short password standing alone"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Manual 2FA reset must not leave a short password standing alone

## Summary

`scripts/mfa-reset.ts` turns MFA off with no length check, so an 8-character password (allowed with MFA) can end up as the only factor; it also leaves `pending_email`.

## Background

Auth audit 2026-10-10 L8. The route enforces spec §5.4 ("a password under 15 can't stand alone", `server/routes/auth-mfa.ts` disable); the operator script skips it.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [x] The script refuses (or requires a forced password reset) when the account's password is shorter than PASSWORD_MIN_SINGLE_FACTOR, with a clear message for the operator
- [x] `pending_email` is cleared like the route's disable path
- [x] The runbook's After section tells the person to set a 15+ password when that path is taken
- [x] Script test covers both branches (dry-run default kept)

## Implementation Notes

- `scripts/mfa-reset.ts:56`, `server/storage/mfa.ts` disableMfa, `docs/runbooks/mfa-manual-reset.md`
- Note: the stored hash can't reveal the password length (pv2$ pre-hash) — the safe option is to force a reset (e.g. issue a reset code / mark password-upgrade-needed) rather than measure.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `scripts/mfa-reset.ts`, `docs/runbooks/mfa-manual-reset.md`, `server/storage/mfa.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)

- Fixed: the script cannot measure the length (pv2$ hash), and since #1370 it does not need to — with two-step off, sign-in gives a password under 15 an upgrade pass (needsPasswordUpgrade), never a session. That is the forced change. The script and runbook now tell the operator and the person to expect it. disableMfa gained clearPendingEmail; the script passes it, so a staged email change is cancelled (the plain route disable still keeps it, by design).
