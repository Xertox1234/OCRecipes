---
title: "Password requirements feel unreasonable (the user hit a 14-character minimum) — find where it comes from and set a sensible policy"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [security, api, react-native]
github_issue:
human_led: true
---

# Password requirements feel unreasonable (the user hit a 14-character minimum) — find where it comes from and set a sensible policy

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

Current guidance is NIST SP 800-63B:

- A minimum of 8 characters.
- Accept long passphrases (at least 64 characters).
- **No composition rules** such as "must contain a digit".
- Check new passwords against known-breached lists.

The current letter-and-digit rule goes against that guidance.

## Acceptance Criteria

- [ ] Reproduce the 14-character requirement and record where it comes from, with a screenshot or the exact message. If it isn't app code, record that too.
- [ ] The user decides the policy: minimum length, maximum length, whether to keep or drop the letter-and-digit rule, and whether to add a breached-password check.
- [ ] Server `registerSchema` and client `LoginScreen-utils.ts` enforce the same policy, and any other place a password is set (the reset flow from the paired todo) uses one shared source of truth for the rule and its message.
- [ ] Existing accounts with passwords that met the old rule can still log in. Login validation stays bounds-only (`loginSchema`).
- [ ] Error copy says exactly what's required, in one sentence.
- [ ] If iOS strong-password autofill is involved, set the password field's `textContentType`/`passwordRules` so iOS generates a password that satisfies the policy.
- [ ] Tests on both sides for the boundary values.
- [ ] Reviewed by `security-auditor`; never auto-merged.

## Implementation Notes

- Changing the policy only affects _new_ passwords; don't re-validate stored ones.
- Keep `max` bounded (bcrypt truncates at 72 bytes; the server currently allows 200). Decide whether to cap at 72 bytes, or pre-hash, so that characters after byte 72 aren't silently ignored.

## Scope Contract

- **Files in scope:** `server/routes/_schemas.ts`, `client/screens/LoginScreen-utils.ts`, `client/screens/LoginScreen.tsx`, a shared password-policy constant (e.g. in `shared/constants/`), and tests.

## Dependencies

- Pairs with `P1-2026-09-26-no-password-reset-or-account-recovery.md`.
