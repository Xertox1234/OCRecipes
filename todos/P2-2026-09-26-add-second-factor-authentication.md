---
title: "Add a second authentication factor — enables the 8-character password option"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-10-10
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
- [x] **DECIDED by the user (2026-10-10), superseding the 2026-09-26 ruling: our second factor guards PASSWORD login only.** A verified Google/Apple sign-in issues a normal access token even on an MFA account — the provider's own second factor covers that path (Apple requires 2FA on every Apple Account; Google prompts for it), and stacking ours on top was judged overkill. **Exception:** linking a Google/Apple identity to an existing MFA-enabled account requires our second factor once at link time, so a guessed password can't be turned into a permanent MFA bypass by attaching the attacker's own provider account. _(Superseded 2026-09-26 ruling: the second factor was also required after every Google/Apple sign-in.)_
- [x] **DECIDED by the user (2026-09-26): MFA is optional, tied to password length.** An account either has MFA (password minimum 8) or doesn't (password minimum 15); see the password-policy todo for the enforcement points: signup can't finish on the 8-character path without enrolling, disabling MFA requires a 15+ password, and existing short-password accounts are prompted at login to enroll or lengthen. Every account therefore meets SP 800-63B-4.
- [ ] **Signup enrollment (8-character path):** the factor is enrolled during signup using its own restricted, short-lived token audience (like the MFA-challenge token), accepted only by the enrollment endpoints. **Never issue a normal access token "temporarily"** to let the user enroll.
- [ ] Enrollment: set up the factor from the Profile/Settings screen after confirming the password, with one-time **recovery codes** issued at enrollment. Each code has at least 64 bits from a secure random generator, is stored hashed, is single-use and consumed atomically (a conditional `UPDATE`/`DELETE … RETURNING`, so two concurrent requests can't both redeem it), and is verification-throttled like any other authenticator. After each use the code is invalidated and **a replacement is issued**, and issuing it sends a notification (SP 800-63B-4, "Saved Recovery Codes"). Codes can also be regenerated on demand, which sends a notification too.
- [ ] Login: after the password succeeds, an MFA challenge. The session token is issued only after the second factor passes; an intermediate "password verified" state must not work as an access token (use its own short-lived token audience, the same concern as the reset-token note in the account-recovery todo).
- [ ] TOTP: verify with a small time-window tolerance. Reject replay by storing the last accepted time-step per authenticator and rejecting any step at or below it, updated atomically (a seen-code check fails once the window allows ±1 step). Encrypt the stored secret at rest. Count failed attempts against the challenge token as well as the account, and keep the password and TOTP failure counters separate. Passkey assertion failures count against the same per-authenticator limit (and the challenge token) as TOTP failures, and limit failed attempts per account (within Rev. 4's cap of 100 before disabling the authenticator; a much lower lockout or back-off is fine).
- [ ] Account recovery (P1 todo) interacts correctly, so a compromised mailbox alone can't take over an MFA account. For an MFA account, an emailed reset link on its own is **not** enough. Per SP 800-63B-4 §4.2, "Recovery at AAL2" (verified against the published text by the security review): recovery needs either two recovery codes obtained by different methods (e.g. a saved code plus an issued one), or one recovery code plus a still-bound authenticator, and it always sends a notification.
- [ ] Disabling or resetting MFA requires re-authentication, and notifies the account's email. Disabling is allowed only when the password is 15+ characters, or when a 15+ password is set in the same step (password-policy todo).
- [ ] Tests: enrollment (TOTP and passkey), login with and without MFA, a Google/Apple sign-in on an MFA account that goes straight in, linking a provider to an MFA account that stops at the challenge, wrong/reused code, recovery code use, lockout, and that the intermediate token is rejected by `requireAuth`.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- The session model is a JWT with `tokenVersion` revocation (`server/middleware/auth.ts`, 60s version cache). An MFA-enabled account should bump `tokenVersion` (and invalidate the cache) when MFA is enabled, disabled or reset.
- Passkeys need `associated-domains` (iOS) and `assetlinks.json` (Android), which don't exist yet (see the account-recovery todo). That's a native change, so it needs a new EAS build.
- **Passkeys vs Cloudflare Bot Fight Mode (checked 2026-10-10):** `ocrecipes.com` is proxied by Cloudflare with Bot Fight Mode ON (Free plan), which per Cloudflare's docs _cannot_ be skipped by custom rules. Apple's AASA fetcher and Google's assetlinks verifier are automated clients — the passkeys spec must verify they get through, or turn BFM off / move to Super Bot Fight Mode (Pro, supports Skip). `api.ocrecipes.com` is DNS-only (straight to Railway), so BFM never sees auth traffic — our own limiters are the only brute-force defence.

## Split (2026-10-10)

- **Part 1 — TOTP + recovery codes + trusted phones:** spec `docs/superpowers/specs/2026-10-10-totp-second-factor-design.md`. OTA-shippable. **MERGED 2026-10-10** (#1355 server, #1356, #1357 app, #1358, codify #1359). Live once the app OTA ships and `MFA_SETUP_ENABLED=true` is set.
- **Part 2 — passkeys:** own spec later; native build.
- **Part 3 — 8-character password path:** in `P2-2026-09-26-password-length-policy.md`; depends on part 1.

## Scope Contract

- **Files in scope:** `shared/constants/mfa.ts`, `server/lib/mfa/**`, `shared/schema.ts`, `migrations/0018_mfa_totp.sql`, `server/storage/mfa.ts`, `server/storage/index.ts`, `server/storage/identities.ts`, `server/storage/password-reset.ts`, `server/lib/social-identity/sign-in-gates.ts`, `server/routes/auth.ts`, `server/routes/auth-social.ts`, `server/routes/auth-mfa.ts`, `server/routes.ts`, `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`, `shared/constants/error-codes.ts`, `server/services/email.ts`, `test/integration/auth-routes.itest.ts`, `scripts/mfa-reset.ts`, `docs/runbooks/mfa-manual-reset.md`, `.env.example`, `shared/types/auth.ts`, `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/lib/token-storage.ts`, `client/lib/second-factor-utils.ts`, `client/components/SecondFactorField.tsx`, `client/screens/TwoStepCodeScreen.tsx` (+ `-utils.ts`), `client/screens/TwoStepSetupScreen.tsx` (+ `-utils.ts`), `client/screens/LoginScreen.tsx`, `client/screens/ConnectAccountScreen.tsx` (+ `-utils.ts`), `client/lib/social-auth-utils.ts`, `client/components/DeleteAccountModal.tsx`, `client/components/ChangeEmailModal.tsx`, `client/screens/SignInMethodsScreen.tsx`, `client/navigation/RootStackNavigator.tsx`, `client/navigation/ProfileStackNavigator.tsx`, and their tests.

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

### 2026-10-10

- Part 1 (TOTP + recovery codes + trusted phones) implemented per `docs/superpowers/specs/2026-10-10-totp-second-factor-design.md` and plan `docs/superpowers/plans/2026-10-10-totp-second-factor.md`, in two PRs (server, then client). Still open: part 2 passkeys, part 3 the 8-character path. Keep this todo open.
- Part 1 merged as #1355–#1359 (with review follow-ups). The owner applied migration 0018 to production and set `MFA_SECRET_ENC_KEY` on Railway first. The production server answers the new `/api/auth/mfa/verify` route.
- Still open for part 1: a preview OTA and an owner device test, then a production OTA, then `MFA_SETUP_ENABLED=true` (owner yes). Deferred: a leave-screen guard on the "save recovery codes" step.
