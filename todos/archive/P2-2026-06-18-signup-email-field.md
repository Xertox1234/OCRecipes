---
title: "Add a separate email field to signup"
status: backlog
priority: medium
created: 2026-06-18
updated: 2026-06-18
assignee:
labels: [auth, database, enhancement]
github_issue:
---

# Add a separate email field to signup

## Summary

Keep the existing alphanumeric `username` as the login identifier, but also
collect an **email address** at signup (for password reset, receipts/IAP, and
notifications). Decided by the user during the P1 "email-as-username" fix
session (2026-06-18).

## Background

During the P1 fix (`P1-2026-06-18-account-creation-fails-on-device.md`, PR #399),
we found users instinctively type their **email** into the "Username" field,
which the server's `registerSchema` rejects (`^[a-zA-Z0-9_]+$`). PR #399 fixes
the bug by validating client-side and guiding the user. This todo is the
**product follow-up**: rather than only block emails, also capture one in a
dedicated field so the app can do password reset / receipts / notifications.

This is NOT a defect — it's a requested enhancement. It is intentionally a
separate change from PR #399 because it touches the **DB schema (prod
migration)** and the auth route, and should get its own brainstorm + review.

## Open design questions (resolve via brainstorming before coding)

- **Required or optional?** Required is simplest for password-reset value;
  optional avoids friction. (Recommend: required.)
- **Unique?** Almost certainly yes (one account per email). Needs a unique
  index + a 409-style conflict path that does NOT become an enumeration oracle
  (mirror the existing username-conflict handling / `no-error-message-in-ui`).
- **Verification?** Out of scope for v1 (no email-verification flow yet); store
  as-entered, normalized (trim + lowercase). Revisit when password-reset ships.
- **Existing accounts?** The prod DB currently has only test accounts
  (pre-launch). If `email` is required + unique, decide nullable-then-backfill
  vs. required-from-go. Pre-launch → likely safe to add as required.
- **Does anything consume it yet?** Password reset / email sending is not built.
  Adding the column now is groundwork; confirm we want to store before we use.

## Acceptance Criteria

- [ ] `users` table has an `email` column (decide nullable + unique index).
- [ ] `registerSchema` validates email (`z.string().email()`, normalized) and
      the register route persists it via `storage.createUser`.
- [ ] Conflict on duplicate email returns a safe, static client message (no
      enumeration oracle; consistent with the username-conflict path).
- [ ] `LoginScreen` register mode has an Email `TextInput` (a11y label/hint,
      `keyboardType="email-address"`, `autoCapitalize="none"`), wired through
      `useAuth.register` / `AuthContext`.
- [ ] Client-side validation in `LoginScreen-utils.validateAuthForm` extended to
      validate the email (reuse the same pure-function + test pattern).
- [ ] Tests: schema (shared), route (register persists email + conflict), and
      client utils/render. Existing P1 tests still pass.
- [ ] Login is unaffected (still username + password; do NOT switch login to
      email unless separately decided).

## Implementation Notes

- Schema: `shared/schema.ts` users table + Drizzle. Migration via `npm run db:push`
  — **prod migration**: verify `DATABASE_URL` points at prod and review the diff
  before applying (see P1 risks). DB/DDL todos are serial — own batch.
- Route: `server/routes/auth.ts` `register` + `server/routes/_schemas.ts`
  `registerSchema`; `storage.createUser` signature + the users storage module.
- Client: `client/screens/LoginScreen.tsx` (new field), `client/hooks/useAuth.ts`
  - `client/context/AuthContext.tsx` (`register` signature gains `email`),
    `client/screens/LoginScreen-utils.ts` (`validateAuthForm` email rule).
- Security: registration/validation is in the NEVER-delegate set — implement
  directly. Keep the `no-error-message-in-ui` rule (static, code-based copy).

## Dependencies

- Builds on PR #399 (P1 fix) being merged (shares `LoginScreen.tsx` +
  `LoginScreen-utils.ts` + `LoginScreen.test.tsx` — wait for #399 to MERGE to
  avoid a stacked-branch conflict).

## Risks

- **Prod DB migration** — schema change against the live Railway DB. Pre-launch
  (only test accounts), so low blast radius, but review the `db:push` diff.
- **Auth is historically fragile** — narrow, well-tested changes; prefer
  real-module/integration coverage for the route.
- Enumeration: a duplicate-email conflict must not leak existence any more than
  the existing username-conflict path does.

## Updates

### 2026-06-18

- Initial creation. Product decision captured during the P1 email-as-username
  fix session (PR #399). Needs brainstorming on required/unique/verification
  before implementation.

### 2026-06-18 (IMPLEMENTED — branch feat/signup-email-field)

- Brainstormed → spec (`docs/superpowers/specs/2026-06-18-signup-email-field-design.md`)
  → plan (`docs/superpowers/plans/2026-06-18-signup-email-field.md`) → implemented
  directly (auth = NEVER-delegate).
- Decisions: email **required + unique + normalized** (trim/lowercase); added
  forward-compat `emailVerified` column (ungated); conflict UI stays generic
  (no enumeration); register body validation switched `.parse()` → `safeParse`.
- Verification deferred to [[P2-2026-06-18-email-verification-resend]] (Resend).
- Dev DB migrated (Path A: dropped disposable test rows → `db:push`); demo
  account recreated with email. **Prod migration is post-merge, gated.**
- 4 commits; auth (97) + storage (668) + client (31) suites green; check:types clean.
