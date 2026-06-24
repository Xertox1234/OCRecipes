---
title: "Add an account email-change feature (update users.email + re-verify new address)"
status: done
priority: medium
created: 2026-06-23
updated: 2026-06-24
assignee:
labels: [feature, auth, security, api]
github_issue:
---

# Account email-change feature

## Summary

Let an authenticated user change the email on their account. Email is currently
**immutable** (no endpoint mutates `users.email` after signup), which is why a
cluster of forward-compat guards sit dormant. This todo lands the feature and the
guards together.

## Background

Surfaced while scoping `P3-2026-06-18-verify-email-cross-check-token-email.md`,
which is `blocked` purely because no email-change feature exists. The whole
email-verification stack (`signVerificationToken` / `verifyVerificationToken` in
`server/lib/verification-token.ts`, the verify handler in `server/routes/auth.ts`)
already assumes a verified-email lifecycle but has no mutate path. This is
**auth-sensitive code — NEVER delegate** (see CLAUDE.md). Implement inline with
real-module tests.

## Acceptance Criteria

- [ ] Authenticated endpoint to change email (e.g. `POST /api/auth/change-email`),
      requiring **password re-authentication** before accepting the change.
- [ ] New email is stored as **unverified** and a fresh verification link is sent
      to the **new** address via the existing email-verification flow.
- [ ] Uniqueness enforced against the `lower(email)` index — a new email already in
      use is rejected, with anti-enumeration parity (neutral response, equalized
      awaited work; see `docs/solutions/logic-errors/anti-enum-equalize-awaited-work-*`).
- [ ] Outstanding verification links for the **old** address are neutralized — land
      the cross-check guard from `P3-2026-06-18-verify-email-cross-check-token-email.md`
      in the same change so a stale old-address link can't flip the new address verified.
- [ ] Client UI surface to initiate the change (Profile/settings), iOS + Android.
- [ ] Real-module tests: happy path, wrong-password reject, duplicate-email reject,
      and the stale-token-after-change case.

## Implementation Notes

- Endpoint goes in `server/routes/auth.ts`; reuse `signVerificationToken(userId, newEmail)`
  and the existing send path so the two entry points never drift.
- Storage: add a `updateUserEmail(id, newEmail)` (sets email + `email_verified=false`
  atomically). Compare/normalize **case-insensitively** to match the `lower(email)`
  unique index — a bare `===` will mis-handle case.
- Cross-check guard (the blocked P3): in `applyVerificationToken`, assert
  `payload.email` equals the row's current email (normalized) before
  `markEmailVerified` — Option B (fold the equality into the `WHERE`) keeps it a
  single atomic statement. Tokens always carry a non-empty `email` claim
  (`verification-token.ts:49`) and have a 24h TTL, so this never false-rejects.
- Consider rate-limiting the change endpoint like the other auth limiters.

## Dependencies

- None blocking. This todo **unblocks**
  `P3-2026-06-18-verify-email-cross-check-token-email.md` — pair them.

## Risks

- Auth/security-critical: a flawed flow could let an attacker hijack an account's
  email or mark an unverified address verified. Treat as high-risk (auth history of
  recurring breakage — see `project_auth_recurring_breakage`). Do inline, not delegated.

## Updates

### 2026-06-23

- Created while scoping the blocked verify-email cross-check todo, which is dormant
  until this feature exists.

### 2026-06-24 (DONE — implemented inline on branch `feat/account-email-change`)

- `POST /api/auth/change-email` (`server/routes/auth.ts`): requireAuth +
  `changeEmailLimiter` (user-keyed 5/hr) + password re-auth, mirroring register's
  ON/OFF gate. Gate ON → neutral `verification_pending` for free / taken /
  same-as-current (anti-enum); gate OFF → returns updated user, explicit 409 on
  duplicate.
- Storage: `updateUserEmail(id, newEmail)` (sets email + `email_verified=false`
  atomically). Duplicate handled by catching the 23505 on `isUniqueViolation`
  alone (NOT constraint name) — `updateUserEmail` only touches the email columns,
  so a name-gated check that fell through to 500 would itself be the enumeration
  oracle.
- Cross-check guard (the blocked P3) landed: `markEmailVerified(id, expectedEmail)`
  folds `lower(email)=lower(expectedEmail)` into the WHERE; `applyVerificationToken`
  passes `payload.email`. A stale old-address link now updates zero rows → 400.
- Client: `ChangeEmailModal` (mirrors `DeleteAccountModal`, iOS+Android),
  `useAuth.changeEmail`, SettingsScreen "Change Email" entry.
- Tests: route (gate ON/OFF happy, wrong-pw, duplicate-neutral, same-email no-op,
  404s, 400s), storage real-module (updateUserEmail reset + case-insensitive
  collision; markEmailVerified case-insensitive match + stale-token reject), hook
  (gate ON/OFF/error). Full `npm run preflight` green.
- Reviewed by security-auditor (SHIP) + code-reviewer (shippable). Follow-up filed:
  `P3-2026-06-24-change-email-staging-enumeration-sidechannel.md` (staging-column
  design — a gate-flip prerequisite that closes both the /me enumeration channel
  and the typo-lockout-once-gate-ON risk). Unblocks + resolves
  `P3-2026-06-18-verify-email-cross-check-token-email.md`.
