---
title: "Make users.email NOT NULL migration-safe (expand/contract) for populated tables"
status: backlog
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, database]
github_issue:
---

# Make users.email NOT NULL migration-safe (expand/contract) for populated tables

## Summary

`users.email` is declared `text("email").notNull().unique()` with no `.default()`.
Stateless `db:push` re-derives this DDL, so applying the schema to ANY populated
`users` table without emails fails with `column "email" contains null values`.

## Background

Surfaced by finding M4 of the 2026-06-19 full audit (data-integrity). Prod was
migrated manually ahead of PR #400 while the table was effectively empty, so prod
is fine — this is **latent**, not a live break. It bites a dev DB with
pre-existing rows, or any future deploy to a populated environment that hasn't been
hand-migrated. `seed-recipes.ts` recreates the demo user with an email, masking it
during seeding.

Deferred (not fixed now) because it is latent and the fix is a migration/runbook
concern, not a code defect.

## Acceptance Criteria

- [ ] Document the expand/contract requirement for `users.email` (nullable → backfill
      → flip NOT NULL) where the schema/migration process is described, OR add a
      guarded backfill step.
- [ ] Confirm `npm run db:push` against a populated dev `users` table without emails
      no longer hard-fails (or the failure is documented with the recovery step).

## Implementation Notes

- `shared/schema.ts:34` — `email: text("email").notNull().unique()`.
- Precedent + rationale: `docs/solutions/best-practices/adding-not-null-column-to-shared-table-blast-radius-2026-06-18.md`.
- This is expand/contract: the old build ignoring an added nullable column is the
  zero-downtime path; the NOT NULL flip happens only after backfill.
