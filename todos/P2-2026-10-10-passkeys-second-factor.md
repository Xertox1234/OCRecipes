---
title: "Passkeys as a second factor (MFA part 2)"
status: backlog
priority: medium
created: 2026-10-10
updated: 2026-10-10
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Passkeys as a second factor (MFA part 2)

## Summary

Add passkeys (Face ID / Touch ID via the iOS and Android platform authenticators) as a second factor next to the authenticator-app code that shipped in MFA part 1. The user decided on 2026-09-26 that both are supported and a user can enrol either or both.

## Background

Split out of `todos/archive/P2-2026-09-26-add-second-factor-authentication.md` when MFA part 1 (TOTP, recovery codes, trusted phones) went live on 2026-10-10 (#1355–#1359, prod OTA 2f2196e5 on build 8, `MFA_SETUP_ENABLED=true`). The rulings in that todo still bind: our second factor guards **password** sign-in only; linking a Google/Apple identity to an MFA account needs the second factor once at link time; MFA is optional and tied to password length (part 3, `P2-2026-09-26-password-length-policy.md`).

NIST SP 800-63B-4: syncable passkeys qualify as a phishing-resistant factor (barred only at AAL3, which this app doesn't need). Failed attempts per authenticator SHALL be capped at 100 before disabling it.

Human-led: auth is high-risk in this codebase.

## Acceptance Criteria

- [ ] A spec under `docs/superpowers/specs/` (via brainstorming), reviewed with `/spec-review`, before any code.
- [ ] Enrolment from the two-step settings screen after confirming the password; a user can hold a passkey, a TOTP authenticator, or both. Recovery codes from part 1 keep working.
- [ ] Login: a passkey assertion satisfies the existing MFA challenge (same short-lived challenge token audience as TOTP; never a normal access token before the factor passes).
- [ ] Passkey assertion failures count against the same per-authenticator limit and challenge-token limit as TOTP failures.
- [ ] Removing the last authenticator counts as "disabling MFA" (re-auth, email notification, and the part-3 15+ password rule once part 3 ships).
- [ ] iOS `associated-domains` entitlement and the `apple-app-site-association` file; Android `assetlinks.json`. Verified that Apple's and Google's fetchers actually get through Cloudflare (see Risks).
- [ ] Tests: passkey enrolment, login with passkey, wrong/failed assertion counting, removing the last authenticator, provider-link on an MFA account accepting a passkey.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- Part 1's server pieces to extend: `server/lib/mfa/verify-second-factor.ts`, `server/lib/mfa/challenge.ts`, `server/routes/auth-mfa.ts`, `server/storage/mfa.ts`. Client: `client/screens/TwoStepSetupScreen.tsx`, `client/screens/TwoStepCodeScreen.tsx`, `client/components/SecondFactorField.tsx`.
- Session model: JWT with `tokenVersion` revocation (`server/middleware/auth.ts`, 60s version cache) — bump on enrol/remove like part 1 does.
- Native change (entitlements + a passkey module) ⇒ a new EAS build and a runtime-version bump; can't ship by OTA. The repo keeps committed `ios/`/`android/` (no CNG), so entitlements are hand-edited.

## Dependencies

- MFA part 1 (done, 2026-10-10).
- A new native build.

## Risks

- **Cloudflare Bot Fight Mode (checked 2026-10-10):** `ocrecipes.com` is proxied with Bot Fight Mode ON (Free plan), which custom rules cannot skip. Apple's AASA fetcher and Google's assetlinks verifier are automated clients — confirm they get through, or turn BFM off / move to Super Bot Fight Mode (Pro, supports Skip). `api.ocrecipes.com` is DNS-only (straight to Railway), so auth traffic itself is unaffected.
- A passkey that syncs through a compromised Apple/Google account is a standing factor; document this in the spec's threat model.

## Updates

### 2026-10-10

- Split out of the MFA todo after part 1 went live.
