---
title: "Add Sign in with Google and Sign in with Apple — essential login options (and Apple's guideline 4.8 requires Apple alongside Google)"
status: backlog
priority: high
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Add Sign in with Google and Sign in with Apple — essential login options (and Apple's guideline 4.8 requires Apple alongside Google)

## Summary

The user considers Google and Apple sign-in essential upgrades (2026-09-26). Today OCRecipes has only username-and-password accounts. Adding both gives users a login with no password to remember, and it's the standard expectation for a consumer app.

## Background

Raised while parking the broader auth review. Human-led: auth is high-risk in this codebase.

Apple's rules, checked against the published text on 2026-09-26:

- **App Store Review Guideline 4.8 (Login Services):** an app that uses a third-party login such as Google Sign-In for the user's primary account "must also offer as an equivalent option another login service" that limits data collection to name and email, lets users keep their email private, and doesn't track them for ads without consent. Sign in with Apple meets that. **Shipping Google sign-in on iOS without Apple risks rejection, so build both together.**
- **Account deletion** (Apple's "Offering account deletion in your app"): "Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens" when a user deletes their account. OCRecipes already has in-app deletion (`DELETE /api/auth/account`); it would need to call Apple's revoke endpoint for Apple-linked accounts.

This also bears on the owner's lockout (`P1-2026-09-26-no-password-reset-or-account-recovery.md`): signing in with Google on the same verified email could restore access to an existing account, **if** account linking is designed safely (see the AC).

## Acceptance Criteria

- [ ] **Server verifies identity tokens, never trusts the client.** Verify Google and Apple ID tokens against each provider's published JWKS: signature, issuer, **audience = our client IDs**, expiry, and a **nonce** bound to this sign-in attempt (a hashed nonce for Apple). Then issue our own session JWT.
- [ ] **Data model:** a separate identities table keyed by (provider, provider subject `sub`), linked to the user, so one account can have a password, Google and Apple. Key on `sub`, never on email, because emails change and Apple's can be a private relay address.
- [ ] **Account linking is safe:**
  - Auto-link a provider identity to an existing account only when the provider asserts the email is verified **and** it equals the account's _verified_ `email` (never `pendingEmail`).
  - Otherwise create a new account, or require the user to sign in with their password first and then link.
  - Record the linking rule in the PR.
- [ ] **Apple specifics:**
  - Apple sends the user's name and email only on the _first_ authorization, so persist them then.
  - Handle Hide My Email relay addresses.
  - Revoke Apple tokens via the REST API when the account is deleted.
- [ ] **Google specifics:** use the native Google Sign-In SDK on Android and iOS (not an in-app web view, which Google blocks).
- [ ] **Accounts with no password:** a social-only account must still work with the reset/recovery flow and MFA decisions. Decide whether such accounts can add a password later, and whether unlinking the last login method is blocked.
- [ ] Deleting an account removes its linked identities too.
- [ ] Buttons follow each provider's branding guidelines. Apple's button must be at least as prominent as Google's (guideline 4.8's "equivalent option").
- [ ] Tests: token verification (bad signature, wrong audience, expired, nonce mismatch), linking rules (verified vs unverified email, `pendingEmail` excluded), first-login vs repeat Apple payload, and account deletion revoking Apple tokens.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- Client libraries: `expo-apple-authentication` for Apple, and `@react-native-google-signin/google-signin` for Google (check current Expo SDK 54 compatibility with Context7 first). Both are **native modules**, so they need a new EAS build and can't ship by OTA. The committed `ios/`/`android/` folders mean entitlements and Gradle/Podfile changes are made by hand; this repo doesn't run `expo prebuild`.
- Apple: needs the "Sign in with Apple" capability on the App ID, plus a Services ID and key for the REST revoke call. The Apple developer account setup is still pending on the user's side (the app has never reached TestFlight).
- Google: OAuth client IDs for iOS, Android (with the signing SHA-1) and web (as the server audience).
- Session model: reuse the existing JWT + `tokenVersion` (`server/middleware/auth.ts`). A social sign-in issues the same access token the password login does.

## Scope Contract

- **Files in scope:** `server/routes/auth.ts`, a new token-verification module under `server/lib/`, `server/storage/users.ts` plus a new identities storage module, `shared/schema.ts` (identities table), `client/screens/LoginScreen.tsx`, native config (`ios/` entitlements, Android config, `app.json`), and tests.
- Changes to `server/middleware/auth.ts` need an explicit security review.

## Risks

- Unsafe auto-linking by email is an account-takeover path. The verified-email-only rule is essential.
- This needs a new native build and Apple developer account setup, so it can't be delivered by OTA to the current preview build.

## Dependencies

- Interacts with `P1-2026-09-26-no-password-reset-or-account-recovery.md` (recovery for accounts with no password; possible lockout relief) and `P2-2026-09-26-add-second-factor-authentication.md` (MFA for password logins; provider sign-ins rely on the provider's own protections).
- Blocked in practice on the user's Apple developer account setup.

## Updates

### 2026-09-26

- Filed at the user's request ("essential upgrades"). Apple guideline 4.8 and the account-deletion token-revocation guidance were checked against Apple's published pages.
