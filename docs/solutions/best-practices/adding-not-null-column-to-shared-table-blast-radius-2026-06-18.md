---
title: Adding a NOT NULL column to a shared table — blast-radius checklist
track: knowledge
category: best-practices
module: shared
tags: [drizzle, zod, migration, schema, testing, not-null, insert-schema]
applies_to: [shared/schema.ts, server/storage/**/*.ts, test/**/*.ts]
created: '2026-06-18'
last_updated: '2026-06-20'
---

# Adding a NOT NULL column to a shared table — blast-radius checklist

## When this applies

Adding a `NOT NULL` (especially `NOT NULL UNIQUE`) column to a heavily-used table
(`users`, etc.). The change looks like a one-line schema edit but ripples into
type derivations, every insert fixture, every schema-parse test, and the
migration. Grep-by-feature misses most of these; the type checker + full test
run are the only reliable blast-radius detectors.

## Smell patterns

- "I added the column to the pgTable and updated the one obvious caller."
- Targeted local test runs pass, but CI shards 2/3 fail.
- A diagnostic on the new column looks self-contradictory (one line says the
  insert type lacks it, another says it requires it) — a sign the type derivation
  is decoupled, not a cold-LSP false positive.

## Why

Three derivations off the same Drizzle table update **differently** when a column
is added — this is the trap:

- `User = typeof users.$inferSelect` — **auto-updates** (all columns; NOT NULL = required).
- raw `db.insert(users).values({...})` uses `$inferInsert` — **auto-updates** (NOT NULL-no-default = required).
- `InsertUser = z.infer<typeof insertUserSchema>` where
  `insertUserSchema = createInsertSchema(users).pick({...})` — does **NOT**
  update. `.pick()` is an explicit allowlist; the new column is silently absent
  until you add it to the pick list. `createUser(insertUser: InsertUser)` then
  can't carry it.

And `NOT NULL` without a default **cannot** be added to a non-empty table
(`ALTER TABLE ... ADD COLUMN ... NOT NULL` errors `column contains null values`).

## Examples

Checklist for a `NOT NULL` column add (`email` on `users`, PR #400):

1. **Schema** — add the column to the pgTable, AND add it to every
   `createInsertSchema(...).pick({...})` that should accept it
   (`insertUserSchema`). `$inferSelect`/`$inferInsert` need no edit.
2. **Insert fixtures (the real sweep)** — there are usually two choke points:
   the real-DB factory (`test/db-test-utils.ts` `createTestUser`) and the mocked
   factory (`server/__tests__/factories/user.ts` `createMockUser`, which returns
   `$inferSelect` → compile-forced). Generate a **unique** value per call for a
   UNIQUE column (reuse the existing unique-username generator), or the 2nd
   insert collides. Then any direct `db.insert(users)` in tests + the seed
   script.
3. **Schema-parse tests** — every test that `safeParse`s the touched schema with
   a payload lacking the new field (e.g. `_helpers.test.ts` registerSchema,
   `shared/__tests__/schema.test.ts` insertUserSchema). The "strips extra fields"
   test must add the field to BOTH input and the expected stripped output once
   it's picked.
4. **Migration** — `NOT NULL` onto a non-empty table needs either delete-then-push
   (disposable rows) or nullable → backfill → flip-to-`NOT NULL` → push. A
   `boolean default false NOT NULL` companion column is exempt (the default
   backfills).
5. **Verify with `npm run check:types` AND `npm run test:run`** — not targeted
   suites. The repo-wide type check catches `.pick()` / `$inferSelect` literal
   breaks; the full run catches schema-parse + fixture failures in suites you
   didn't think to run. Targeted runs have blind spots exactly here.

### Re-applying an existing `NOT NULL UNIQUE` column to a populated dev DB (`users.email`)

The same hazard bites a column that is **already merged**, not just a fresh add.
`users.email` is `text("email").notNull().unique()` with **no `.default()`**.
`db:push` is **stateless** — it diffs the live DB against the schema and
re-derives the full DDL each run, so any `users` table that already has rows
**without** an `email` value makes `db:push` hard-fail with
`column "email" contains null values`. Prod is unaffected (it was hand-migrated
ahead of PR #400 while `users` was effectively empty), and `seed-recipes.ts`
masks it locally by recreating the demo user *with* an email — so this is a
**latent** trap for any dev DB that carries pre-existing emailless rows, or any
future deploy to a populated environment that skipped the manual migration.

**Recovery — backfill before re-pushing** (run against the dev/target DB; the
`gen_random_uuid()` placeholder satisfies the `UNIQUE` constraint and is
idempotent because the `WHERE email IS NULL` guard skips already-populated rows):

```sql
-- 1. Expand+backfill: give every emailless row a unique placeholder so the
--    NOT NULL UNIQUE flip can succeed. Safe to re-run — and once `db:push` has
--    enforced NOT NULL, the `WHERE email IS NULL` guard is structurally
--    unreachable, so later re-runs are silent no-ops.
UPDATE users
SET email = 'placeholder+' || gen_random_uuid() || '@invalid.local'
WHERE email IS NULL;
```

```bash
# 2. Contract: re-derive the schema now that no NULLs remain.
npm run db:push
```

For a **disposable** dev DB, the faster path is delete-then-push: truncate
`users` (and FK-dependent rows) and let `db:push` recreate the constraint
cleanly. Prefer the backfill above when the rows must be preserved.

## Exceptions

- A `NOT NULL` column **with a `.default(...)`** (or a nullable column) skips the
  migration-on-non-empty-table problem and is optional in `$inferInsert`.
- If the picked insert schema is meant to *exclude* the column (server-stamped /
  never client-supplied), don't add it to `.pick()` — but then no insert caller
  can set it, which is the intended guard (e.g. `emailVerified` falls to its DB
  default).

## Related Files

- `shared/schema.ts` — `users` table, `insertUserSchema` pick
- `test/db-test-utils.ts` — `createTestUser`
- `server/__tests__/factories/user.ts` — `createMockUser`
- `server/routes/__tests__/_helpers.test.ts`, `shared/__tests__/schema.test.ts`

## See Also

- [A 23505 catch on a table with multiple unique columns must branch on the constraint name](../logic-errors/multi-unique-column-23505-needs-constraint-name-2026-06-18.md) — another ripple of the same email-column add
