---
title: "Add a second authentication factor — required for the user's chosen 8-character password minimum"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Add a second authentication factor — required for the user's chosen 8-character password minimum

## Summary

OCRecipes logs in with a username and password only. The user chose a minimum password length of 8 characters "with a second or even third factor" (2026-09-26). NIST SP 800-63B-4 allows 8 only when the password is part of multi-factor authentication, so this second factor is a prerequisite for that policy.

## Background

Decided while parking the auth review (see `P2-2026-09-26-password-length-policy.md`, "DECIDED"). Human-led: auth is high-risk in this codebase.

What SP 800-63B-4 (final, 26 Aug 2025; https://pages.nist.gov/800-63-4/sp800-63b.html) says about factors, checked 2026-09-26:

- **Email codes do NOT count.** "Email SHALL NOT be used for out-of-band authentication." Codes that confirm an email address, and recovery codes, are exempt. So the account-recovery todo's email reset is fine, but email can't be the second factor.
- **SMS (PSTN) is "restricted".** Verifiers SHOULD check risk signals (SIM swap, number porting) before relying on it, and it has a cost and a carrier dependency.
- **An authenticator-app code (TOTP) qualifies** as a factor combined with the password.
- **Passkeys (syncable WebAuthn authenticators) qualify** and are phishing-resistant. They're barred only at AAL3, which this app doesn't need.
- Failed attempts per authenticator SHALL be limited to no more than 100 before that authenticator is disabled.

Candidate factors, strongest and simplest first:

1. **Passkey** (Face ID / Touch ID via iOS and Android platform authenticators). Best user experience and phishing-resistant. It needs native modules and verified associated domains, so a new build, not OTA.
2. **Authenticator app (TOTP, RFC 6238).** Server-side only plus one screen, which could ship by OTA. Needs enrollment (QR code or secret) and recovery codes.
3. **SMS:** not recommended (restricted, costly, SIM-swap risk).

## Acceptance Criteria

- [ ] The user chooses the factor(s) (a recommended pair is TOTP now and passkeys later), and whether MFA is **mandatory** for all accounts or opt-in. The 8-character minimum is Rev. 4-compliant only for accounts that actually have MFA; with opt-in MFA, password-only accounts stay below it. Record the decision.
- [ ] Enrollment: set up the factor from the Profile/Settings screen after confirming the password, with one-time **recovery codes** issued at enrollment (stored hashed, each single-use, and able to be regenerated).
- [ ] Login: after the password succeeds, an MFA challenge. The session token is issued only after the second factor passes; an intermediate "password verified" state must not work as an access token (use its own short-lived token audience, the same concern as the reset-token note in the account-recovery todo).
- [ ] TOTP: verify with a small time-window tolerance, reject reuse of the same code within its window, encrypt the stored secret at rest, and limit failed attempts per account (within Rev. 4's cap of 100 before disabling the authenticator; a much lower lockout or back-off is fine).
- [ ] Account recovery (P1 todo) interacts correctly: decide whether a password reset also requires the second factor (or a recovery code), so a compromised mailbox alone can't take over an MFA account.
- [ ] Disabling or resetting MFA requires re-authentication, and notifies the account's email.
- [ ] Tests: enrollment, login with and without MFA, wrong/reused code, recovery code use, lockout, and that the intermediate token is rejected by `requireAuth`.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- The session model is a JWT with `tokenVersion` revocation (`server/middleware/auth.ts`, 60s version cache). An MFA-enabled account should bump `tokenVersion` (and invalidate the cache) when MFA is enabled, disabled or reset.
- Passkeys need `associated-domains` (iOS) and `assetlinks.json` (Android), which don't exist yet (see the account-recovery todo). That's a native change, so it needs a new EAS build.

## Scope Contract

- **Files in scope:** `server/routes/auth.ts`, `server/middleware/auth.ts` (MFA state only, with explicit security review), `server/storage/users.ts`, `shared/schema.ts` (MFA secret, recovery codes, enrollment state), `client/screens/LoginScreen.tsx`, a new MFA challenge screen and an enrollment screen, and tests.

## Risks

- Mandatory MFA locks out users who lose their device, so recovery codes and a support path must exist before enforcing it.
- Passkeys need a new native build, so they can't ship by OTA.

## Dependencies

- Prerequisite for the 8-character minimum in `P2-2026-09-26-password-length-policy.md`.
- Interacts with `P1-2026-09-26-no-password-reset-or-account-recovery.md` (reset flow and MFA).

## Updates

### 2026-09-26

- Filed after the user chose "8 characters with a second or even third factor" over the 15-character password-only minimum. The NIST factor rules above were checked against the published SP 800-63B-4.
