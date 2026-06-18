---
title: "Email verification via Resend"
status: backlog
priority: medium
created: 2026-06-18
updated: 2026-06-18
assignee:
labels: [auth, security, email, enhancement]
github_issue:
---

# Email verification via Resend

## Summary

Verify the email address collected at signup, as a security measure, using
Resend (account/credentials available; **no code wired yet**). This is the
deferred follow-up to "Add a separate email field to signup"
(`P2-2026-06-18-signup-email-field.md`), split out during that todo's
brainstorm because verification is a whole subsystem.

## Background

The signup-email-field change adds a required, unique, normalized `email`
column **plus a forward-compatible `emailVerified boolean default false`
column** (already in the schema, ungated). This todo builds the verification
flow on top of `emailVerified` — so it needs **no new prod DDL migration**.

Verifying email also unlocks **true anti-enumeration** at signup: on a
duplicate-email registration, instead of an inline "email already registered"
error, send a "someone tried to sign up with your email" message and show the
new user a neutral "check your inbox" — an attacker can't distinguish. The
field-only change keeps the generic-UI mirror of the username path until this
ships.

## Open design questions (resolve via brainstorming before coding)

- **Gating policy:** hard-gate login until verified, soft banner/nag, or no gate
  yet (groundwork only). Pre-launch leans soft/none to avoid locking out test
  accounts.
- **Token strategy:** signed/stateless token (JWT-style, no table) vs. a DB
  verification-token table (revocable, expiring). Lean stateless + short TTL.
- **Deep-link UX:** verification URL handled via existing linking
  (`ocrecipes://`, `https://ocrecipes.app`) → a verify screen that calls the
  endpoint. Universal-link vs. custom-scheme behavior for email clients.
- **Resend-verification flow:** a "didn't get it? resend" endpoint with its own
  rate limit.
- **Anti-enumeration on signup:** adopt the "check your inbox" pattern (see
  Background) once sending exists.

## Acceptance Criteria

- [ ] `resend` integration + `RESEND_API_KEY` / `EMAIL_FROM` config (documented
      in `docs/DEV_SETUP.md`; secret, no `EXPO_PUBLIC_` prefix).
- [ ] `server/services/email.ts` (or similar) sends a verification email via
      Resend; no-op/guarded when the key is absent (mirror `reporter.ts` no-op).
- [ ] Verification token issued at signup (strategy per design) + a
      `POST /api/auth/verify-email` endpoint that flips `users.emailVerified`.
- [ ] Resend-verification endpoint with its own rate limit.
- [ ] Deep-link handler routes the verification URL to a verify screen.
- [ ] Send-rate-limiting to prevent abuse; Resend domain SPF/DKIM/DMARC set up.
- [ ] Gating policy implemented per the brainstorm decision.
- [ ] Tests: token issue/verify, endpoint (valid/expired/already-verified),
      email-service guard, rate limit, deep-link routing.

## Implementation Notes

- Builds on the `email` + `emailVerified` columns from the field-only change —
  **no new prod migration** for verification itself.
- Auth/security = **NEVER-delegate**; implement directly (not via executor or
  cheap worker).
- Spec for the prerequisite field change:
  `docs/superpowers/specs/2026-06-18-signup-email-field-design.md` (local-only).
- Existing deep linking: `client/navigation/linking.ts`.

## Dependencies

- **Blocked by** `P2-2026-06-18-signup-email-field.md` — needs the `email` +
  `emailVerified` columns merged first.
- Resend account + verified sending domain.

## Risks

- Email deliverability (SPF/DKIM/DMARC) — misconfiguration sends to spam.
- Auth is historically fragile — narrow, well-tested changes; prefer
  real-module/integration coverage.
- Token security — must not be guessable; expire; single-use if DB-backed.
- Abuse — verification/resends are an email-bomb vector without rate limits.

## Updates

### 2026-06-18

- Created during the signup-email-field brainstorm. User confirmed Resend is
  available and wants email verification as a security measure, scoped as a
  **separate** change (decomposition decision). The field-only change adds the
  forward-compatible `emailVerified` column so this needs no second DDL.
