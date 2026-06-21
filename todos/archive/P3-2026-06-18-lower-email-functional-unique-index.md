---
title: "DB-enforce case-insensitive email uniqueness (lower(email) functional unique index)"
status: blocked
priority: low
created: 2026-06-18
updated: 2026-06-20
assignee:
labels: [deferred, database, auth]
github_issue:
---

# lower(email) functional unique index

## Summary

Make case-insensitive email uniqueness **DB-enforced** via a `lower(email)`
functional unique index, instead of relying on every write path calling
`.toLowerCase()`.

## Background

PR #400 added `users.email text NOT NULL UNIQUE` with normalization (`trim` +
`lowercase`) done in the Zod `registerSchema`. Case-insensitive uniqueness
currently holds **only by convention** — the plain `UNIQUE` index is byte-exact,
so it works _because_ every current write path lowercases first
(`registerSchema` for registration, the seed script's hardcoded lowercase
`demo@ocrecipes.test`). Surfaced by the database-specialist review of PR #400.

The risk is latent, not current: a _future_ write or lookup path that forgets to
normalize (login-by-email, an admin tool, a bulk import, the upcoming Resend
email-verification work in [[P2-2026-06-18-email-verification-resend]]) would
silently break uniqueness/lookup. A `lower(email)` functional unique index moves
the invariant from convention to the database.

## Acceptance Criteria

- [x] A unique index on `lower(email)` exists on `users` (replacing or
      alongside the plain `email` unique constraint — decide which).
      → Added `users_email_lower_unique` ALONGSIDE the plain index.
- [x] `getUserByEmail` and the register pre-check still match correctly (they
      already pass normalized values, so behavior is unchanged for current
      callers). → No query change; `WHERE email = $1` unchanged.
- [x] Decide whether to keep the plain `UNIQUE(email)` too (redundant once the
      functional index exists) or drop it. → **KEEP** — the byte-exact index
      backs the `WHERE email = $1` equality lookup (a `lower(email)` index can't
      serve that query shape); the functional index adds only the
      case-insensitive uniqueness guarantee.
- [x] Migration applied to dev + (gated) prod. → dev applied via `db:push`;
      prod migration `migrations/0009_users_email_lower_unique.sql` written and
      ready, to be applied manually at the deploy window (order-independent).

## Implementation Notes

- Drizzle: a functional/expression unique index. Confirm drizzle-kit's support
  for `lower(email)` in the `users` table extraConfig; if `db:push` can't express
  it, a raw `CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))`
  migration may be needed.
- `shared/schema.ts` users table; `server/storage/users.ts` `getUserByEmail`.
- Pairs naturally with the email-verification work, which adds more email write
  paths — consider doing it as part of that change rather than standalone.

## Dependencies

- Builds on PR #400 (email column).

## Risks

- DB/DDL change — serial, own batch; review the migration diff (see PR #400's
  gated prod-migration note).

## Updates

### 2026-06-18

- Created from the database-specialist review of PR #400 (latent hardening note).

### 2026-06-20 (implemented inline — auth/DB, done by orchestrator)

- Added `uniqueIndex("users_email_lower_unique").on(sql\`lower(email)\`)`to the
users table config in`shared/schema.ts`(KEEPING the byte-exact`.unique()`), plus hand-authored `migrations/0009_users_email_lower_unique.sql`for the manual prod apply path.`getUserByEmail` unchanged.
- `db:push` verified it creates `CREATE UNIQUE INDEX ... USING btree
(lower(email))` on a fresh DB (how CI builds its test DB). Known drizzle-kit
  quirk: it can't introspect the expression so repeat dev pushes re-emit it
  (churn) — harmless; CI/prod unaffected (one fresh push / hand-applied
  migration).
- Test: new case-variant-duplicate rejection in
  `server/storage/__tests__/users.test.ts` asserting both `isUniqueViolation`
  AND the constraint name contains `email` (the anti-enum routing depends on it).
- Reviewed by `code-reviewer` + `database-specialist` + `security-auditor` (all
  PASS). Migration CONCURRENTLY/IF-NOT-EXISTS footgun note + constraint-name
  test assertion added per their feedback.
- Branch `todo/lower-email-unique-index`; PR opened without auto-merge (DDL —
  prod migration must be applied manually).
