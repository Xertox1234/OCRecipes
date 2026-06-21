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

- [ ] A unique index on `lower(email)` exists on `users` (replacing or
      alongside the plain `email` unique constraint — decide which).
- [ ] `getUserByEmail` and the register pre-check still match correctly (they
      already pass normalized values, so behavior is unchanged for current
      callers).
- [ ] Decide whether to keep the plain `UNIQUE(email)` too (redundant once the
      functional index exists) or drop it.
- [ ] Migration applied to dev + (gated) prod.

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

### 2026-06-20 (blocked — implemented in OPEN PR #418)

- Set `status: blocked`. PR #418 ("feat(db): DB-enforce case-insensitive email
  uniqueness via lower(email) unique index") is OPEN and implements exactly this
  todo (verified: no `lower(email)` index exists in `shared/schema.ts` or
  `migrations/` on main; PR #418 carries the schema change + hand migration).
  Do NOT dispatch an executor for this — it would create a conflicting duplicate
  PR. **Archive this todo when PR #418 merges.**
