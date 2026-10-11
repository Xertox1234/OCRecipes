---
title: "Re-register on an unverified email must not verify the squatter's account"
status: backlog
priority: medium
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Re-register on an unverified email must not verify the squatter's account

## Summary

Re-registering an existing UNVERIFIED email re-sends a link that verifies the EXISTING (possibly attacker-created) account; GET /verify-email also verifies on a plain page load (mail scanners).

## Background

Found while verifying auth audit H1 (`docs/audits/2026-10-10-security.md` M4). H1 closed the takeover (password accounts are never auto-linked), but the squatter can still: register victim@x with their own password → the victim's click (or a scanner prefetch) verifies it → the squatter turns on 2FA → the victim's forgot-password reset keeps MFA (owner ruling D7) → the victim is locked out of the only account their email can hold, recoverable only via the 7-day manual reset.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [ ] Re-registering an existing unverified email no longer sends a link that verifies that account; it sends a "finish by setting a password" message that drives the reset-code flow (which replaces the password and bumps tokenVersion)
- [ ] Optionally: GET /verify-email renders a confirm page that POSTs, so a mail-scanner prefetch can't verify
- [ ] Route tests cover both the unverified re-register message and that the existing account stays unverified until the inbox owner sets the password
- [ ] Anti-enumeration preserved: the same neutral response for new / unverified / verified emails

## Implementation Notes

- `server/routes/auth.ts:256-264` (re-register branch), `:485-504` (GET /verify-email)
- `server/services/email.ts` (new message, security send bucket)
- `server/storage/password-reset.ts` (reuse the reset-code issuance)
- AUTH = never delegate; security label ⇒ never auto-merge.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/routes/auth.ts`, `server/services/email.ts`, `server/routes/__tests__/auth*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)
