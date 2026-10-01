---
title: "Add a second authentication factor — enables the 8-character password option"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Add a second authentication factor — enables the 8-character password option

## Summary

OCRecipes logs in with a username and password only. The user chose to offer an 8-character password option "with a second or even third factor" (2026-09-26). NIST SP 800-63B-4 allows 8 only when the password is part of multi-factor authentication, so this second factor is a prerequisite for that policy.

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

- [x] **DECIDED by the user (2026-09-26): both an authenticator app (TOTP) and passkeys** are supported second factors. A user can enroll either or both. (A user-verifying passkey is itself multi-factor and phishing-resistant, so it could later also serve as a standalone passwordless login. That's optional and not part of this todo.)
- [x] **DECIDED by the user (2026-09-26): the second factor is also required after a Google or Apple sign-in.** For an account with MFA enabled, a verified provider sign-in yields only the short-lived MFA-challenge token (the same one a correct password yields), never an access token, until our second factor passes. So a takeover of the Google/Apple account alone can't get in.
- [x] **DECIDED by the user (2026-09-26): MFA is optional, tied to password length.** An account either has MFA (password minimum 8) or doesn't (password minimum 15); see the password-policy todo for the enforcement points: signup can't finish on the 8-character path without enrolling, disabling MFA requires a 15+ password, and existing short-password accounts are prompted at login to enroll or lengthen. Every account therefore meets SP 800-63B-4.
- [ ] **Signup enrollment (8-character path):** the factor is enrolled during signup using its own restricted, short-lived token audience (like the MFA-challenge token), accepted only by the enrollment endpoints. **Never issue a normal access token "temporarily"** to let the user enroll.
- [ ] Enrollment: set up the factor from the Profile/Settings screen after confirming the password, with one-time **recovery codes** issued at enrollment. Each code has at least 64 bits from a secure random generator, is stored hashed, is single-use and consumed atomically (a conditional `UPDATE`/`DELETE … RETURNING`, so two concurrent requests can't both redeem it), and is verification-throttled like any other authenticator. After each use the code is invalidated and **a replacement is issued**, and issuing it sends a notification (SP 800-63B-4, "Saved Recovery Codes"). Codes can also be regenerated on demand, which sends a notification too.
- [ ] Login: after the password succeeds, an MFA challenge. The session token is issued only after the second factor passes; an intermediate "password verified" state must not work as an access token (use its own short-lived token audience, the same concern as the reset-token note in the account-recovery todo).
- [ ] TOTP: verify with a small time-window tolerance. Reject replay by storing the last accepted time-step per authenticator and rejecting any step at or below it, updated atomically (a seen-code check fails once the window allows ±1 step). Encrypt the stored secret at rest. Count failed attempts against the challenge token as well as the account, and keep the password and TOTP failure counters separate. Passkey assertion failures count against the same per-authenticator limit (and the challenge token) as TOTP failures, and limit failed attempts per account (within Rev. 4's cap of 100 before disabling the authenticator; a much lower lockout or back-off is fine).
- [ ] Account recovery (P1 todo) interacts correctly, so a compromised mailbox alone can't take over an MFA account. For an MFA account, an emailed reset link on its own is **not** enough. Per SP 800-63B-4 §4.2, "Recovery at AAL2" (verified against the published text by the security review): recovery needs either two recovery codes obtained by different methods (e.g. a saved code plus an issued one), or one recovery code plus a still-bound authenticator, and it always sends a notification.
- [ ] Disabling or resetting MFA requires re-authentication, and notifies the account's email. Disabling is allowed only when the password is 15+ characters, or when a 15+ password is set in the same step (password-policy todo).
- [ ] Tests: enrollment (TOTP and passkey), login with and without MFA, a Google/Apple sign-in on an MFA account that stops at the challenge, wrong/reused code, recovery code use, lockout, and that the intermediate token is rejected by `requireAuth`.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- The session model is a JWT with `tokenVersion` revocation (`server/middleware/auth.ts`, 60s version cache). An MFA-enabled account should bump `tokenVersion` (and invalidate the cache) when MFA is enabled, disabled or reset.
- Passkeys need `associated-domains` (iOS) and `assetlinks.json` (Android), which don't exist yet (see the account-recovery todo). That's a native change, so it needs a new EAS build.

## Scope Contract

- **Files in scope:** `server/routes/auth.ts`, `server/middleware/auth.ts` (MFA state only, with explicit security review), `server/storage/users.ts`, `shared/schema.ts` (MFA secret, recovery codes, enrollment state), `client/screens/LoginScreen.tsx`, a new MFA challenge screen and an enrollment screen, and tests.

## Risks

- MFA is optional, but it is effectively mandatory for accounts on the 8-character path, so losing a device can lock those users out. Recovery codes and a support path must exist before the 8-character path ships.
- Passkeys need a new native build, so they can't ship by OTA.

## Dependencies

- Prerequisite for the 8-character password option in `P2-2026-09-26-password-length-policy.md`.
- Interacts with `P1-2026-09-26-no-password-reset-or-account-recovery.md` (reset flow and MFA).

## Updates

### 2026-09-26

- Filed after the user chose "8 characters with a second or even third factor" over the 15-character password-only minimum. The NIST factor rules above were checked against the published SP 800-63B-4.
- 2026-09-26: the user chose TOTP **and** passkeys as factors, and required the second factor after Google/Apple sign-in too. Whether MFA is mandatory for all accounts is still open.
- 2026-09-26 (later): MFA is optional. The user chose "15 characters, or 8 with a second factor", so the mandatory-vs-opt-in question is settled.
