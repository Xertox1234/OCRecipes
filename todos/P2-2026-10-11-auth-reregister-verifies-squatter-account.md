---
title: "Attacker-triggered verify emails can still verify a squatter's account (original sign-up email, resend, scanner prefetch)"
status: backlog
priority: medium
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Attacker-triggered verify emails can still verify a squatter's account (original sign-up email, resend, scanner prefetch)

## Summary

A squatter who registers the victim's email with their own password can still get that account verified through a verify link the victim clicks — the email the squatter's own sign-up sends, or one they re-trigger via `/api/auth/resend-verification` — or that a mail scanner opens (GET `/verify-email` verifies on page load).

## Background

Auth audit 2026-10-10 M4 (`docs/audits/2026-10-10-security.md`, local-only). H1 closed the takeover (password accounts are never auto-linked), but a verified squatter account can turn on 2FA; the victim's forgot-password reset keeps MFA (owner ruling D7) → the victim is locked out of the only account their email can hold, recoverable only via the 7-day manual reset.

**Partly fixed in the audit PR (owner ruling 2026-10-11):** re-registering an existing unverified email now sends a "finish via Forgot password" notice instead of a verify link (`sendFinishSignupNotice`, `server/routes/auth.ts` register branch). Forgot password replaces the password AND verifies, so the inbox owner ends up owning the account. What remains are the paths that still deliver a working verify link the victim never asked for.

## Acceptance Criteria

- [ ] GET `/verify-email` no longer verifies on a plain page load: it renders a confirm page whose button POSTs (a mail-scanner prefetch can't verify). The page must keep its "reflects no request input" property or carry the token safely (strict JWT-charset validation + HTML escaping) — security review required
- [ ] The verification email names the account's username and says "if you didn't create this account, ignore this email", so a victim can recognise a squatter's account
- [ ] Decide `/api/auth/resend-verification` for an unverified account: keep the verify link (legit users) vs switch to the finish-via-Forgot-password notice; record the ruling
- [ ] Route tests cover each path; anti-enumeration preserved (same neutral responses)

## Implementation Notes

- `server/routes/auth.ts` (GET/POST `/verify-email`, resend-verification), `server/lib/verify-email-page.ts`, `server/services/email.ts` (`sendVerificationEmail`)
- `/verify-email` must stay OUTSIDE `/api` (its token must never reach access logs — see the route comment)
- AUTH = never delegate; security label ⇒ never auto-merge.

## Scope Contract

- **Mechanisms to use:** existing verify-token + page renderer; no new token types
- **Files in scope:** `server/routes/auth.ts`, `server/lib/verify-email-page.ts`, `server/services/email.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- The confirm page reflects the token into HTML — the main XSS surface; keep it escaped and charset-validated.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)
- Narrowed after the re-register path was fixed in the audit PR (owner ruling 2026-10-11)
