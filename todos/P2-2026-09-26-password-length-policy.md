---
title: "Password requirements feel unreasonable (the user hit a 14-character minimum) — find where it comes from and decide a policy against current NIST guidance"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Password requirements feel unreasonable (the user hit a 14-character minimum) — find where it comes from and decide a policy against current NIST guidance

## Summary

The user was asked for a password of at least 14 characters and considers that unreasonable. The app's own code doesn't enforce 14. So first find where the requirement actually comes from, then settle on a deliberate password policy and apply it the same way everywhere.

## Background

Raised by the user on 2026-09-26 and parked, together with a broader review of the app's authentication, as human-led work.

What the code enforces, checked on `main` (`0fed116b`) and on preview build 5's commit (`0f3cb7ed`):

- **Server** (`server/routes/_schemas.ts`, `registerSchema.password`): `min(8)`, `max(200)`, and a regex requiring at least one letter **and** one digit.
- **Client** (`client/screens/LoginScreen-utils.ts`): `PASSWORD_MIN = 8`, mirroring the letter-and-digit rule.
- A search of `client/`, `server/` and `shared/` found no 14-character rule, and no `passwordRules`/`textContentType="newPassword"` hint that would make iOS generate a longer password.

So "14" must come from somewhere outside that validation. Candidates to check:

- iOS's suggested strong password or the Passwords app.
- A different screen (change password, delete account, email change).
- An older server or build than expected.
- A misread of the letter-and-digit error.

Reproduce it before changing anything.

**What NIST actually says (checked 2026-09-26).** The current revision is SP 800-63B-4, final, published 26 August 2025 (https://pages.nist.gov/800-63-4/sp800-63b.html):

- Passwords used as the **only** factor SHALL be at least **15 characters**.
- Passwords used only as part of multi-factor authentication may be shorter, but SHALL be at least **8**.
- Maximum length SHOULD be at least 64.
- Composition rules such as "must contain a digit" SHALL NOT be imposed.
- New passwords SHALL be checked against a blocklist of common, expected or compromised passwords.

The older revision (Rev. 3) said a minimum of 8 for all passwords. OCRecipes logs in with a password alone, so **the current standard asks for 15**, which is close to the 14 the user objected to. The current letter-and-digit rule goes against both revisions.

That makes this a genuine trade-off for the user, not a mechanical fix:

- Follow Rev. 4: 15 characters, no composition rule, breached-password screening. That's much easier with a passphrase hint and paste/autofill-friendly fields.
- Add a second factor, which permits a minimum of 8.
- Deliberately accept a shorter minimum below the standard, and record why.

## Acceptance Criteria

- [ ] Reproduce the 14-character requirement and record where it comes from, with a screenshot or the exact message. If it isn't app code, record that too.
- [x] **DECIDED by the user (2026-09-26, revised same day): two compliant options, the user's choice per account.** (a) **Password only: at least 15 characters**, or (b) **password plus a second factor: at least 8 characters.** This matches SP 800-63B-4 exactly (15 single-factor; 8 only within MFA), so no account sits below the standard. It supersedes the earlier "8 with MFA" entry and resolves the MFA todo's mandatory-vs-opt-in question: MFA is **optional**, and choosing no MFA means the 15-character minimum. Enforcement points:
  - **Registration:** the user picks the path. On the 8-character path the account is not usable (no access token is issued) until a second factor is enrolled during signup, so an abandoned signup can't leave an 8-character password-only account.
  - **Disabling MFA:** allowed only if the current password is 15+ characters. Otherwise the user must set a 15+ password in the same step, and the server checks the length of the submitted password, since it can't read length from the hash.
  - **Changing the password:** the minimum follows the account's current state: 15 without MFA, 8 with MFA.
  - **Existing accounts:** the length is known at login (the plaintext is in hand before bcrypt). A successful login with a password under 15 on an account with no MFA gets a restricted, upgrade-only session (or a flag the client must act on) that requires either enrolling MFA or setting a 15+ password before normal use. Existing hashes still verify; only the rule for new and changed passwords changes.
  - The remaining Rev. 4 points apply to both paths: maximum length of at least 64, no composition rules (drop the letter-and-digit rule), and breached-password screening.
  - Error copy names both options, e.g. "Use at least 15 characters, or 8 with two-step verification turned on."
- [ ] (Original criterion, answered above:) The user decides the policy with the NIST Rev. 4 figures above in front of them: minimum length (15 for password-only per Rev. 4, or a deliberate deviation with the reason recorded), maximum length (at least 64), dropping the letter-and-digit rule (Rev. 4 forbids composition rules), and breached-password screening (Rev. 4 requires it).
- [ ] Server `registerSchema` and client `LoginScreen-utils.ts` enforce the same policy, and any other place a password is set (the reset flow from the paired todo) uses one shared source of truth for the rule and its message.
- [ ] Existing accounts with passwords that met the old rule can still log in. Login validation stays bounds-only (`loginSchema`).
- [ ] Error copy says exactly what's required, in one sentence.
- [ ] If iOS strong-password autofill is involved, set the password field's `textContentType`/`passwordRules` so iOS generates a password that satisfies the policy.
- [ ] Tests on both sides for the boundary values.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- Changing the policy only affects _new_ passwords; don't re-validate stored ones.
- bcrypt ignores everything past 72 bytes, and the server currently allows 200 characters. Rev. 4 says the verifier SHALL verify the entire submitted password (no truncation) and SHOULD accept at least 64 characters. Multibyte characters can push 64 characters past 72 bytes, so a 72-byte cap can conflict with that. The compliant options are pre-hashing, or rejecting over-long input outright; never silently truncate.
- Rev. 4 counts each Unicode code point as one character and SHOULD apply NFC normalization. JavaScript's `.length` counts UTF-16 code units, so length checks and boundary tests must use code points (e.g. `[...pw.normalize('NFC')].length`), identically on server and client.
- If you pre-hash before bcrypt, encode the digest (base64/hex of an HMAC or SHA-256). Raw digest bytes can contain NUL, which some bcrypt bindings stop at. Stored hashes also need a version marker, so existing passwords still verify.
- Breached-password screening can use the Have I Been Pwned range API (k-anonymity: only the first 5 characters of the SHA-1 are sent) or a bundled blocklist. The request must never send the password or its full hash.

## Scope Contract

- **Files in scope:** `server/routes/_schemas.ts`, `client/screens/LoginScreen-utils.ts`, `client/screens/LoginScreen.tsx`, a shared password-policy constant (e.g. in `shared/constants/`), and tests.

## Dependencies

- Pairs with `P1-2026-09-26-no-password-reset-or-account-recovery.md`.
- The 8-character path depends on `P2-2026-09-26-add-second-factor-authentication.md`; the 15-character path does not. Removing the letter-and-digit rule and adding breached-password screening do not depend on it.

## Risks

- Any change to password rules also changes the reset flow (P1) and the registration screen; ship them consistently.

## Updates

### 2026-09-26

- Filed at the user's request (auth parked for a broader review). The security-auditor review corrected the NIST figures to Rev. 4, verified against the published text.
- 2026-09-26: the user chose a minimum of 8 characters together with a second (or third) factor, over the 15-character password-only minimum. The MFA todo was filed as its prerequisite.
- 2026-09-26 (later): the user revised the policy to offer both compliant paths, 15 characters password-only or 8 with a second factor. MFA is optional.
