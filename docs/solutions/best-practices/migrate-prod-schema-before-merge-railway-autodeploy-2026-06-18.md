---
title: Migrate prod schema before merging a column-adding PR (Railway auto-deploy)
track: knowledge
category: best-practices
module: server
tags: [railway, deployment, drizzle, migration, expand-contract, zero-downtime, schema]
applies_to: [shared/schema.ts]
created: '2026-06-18'
---

# Migrate prod schema before merging a column-adding PR (Railway auto-deploy)

## When this applies

Any PR that adds or changes a column the server code reads, while the backend is
deployed on Railway with GitHub auto-deploy on push to `main`. More generally:
any expand/contract schema change where the deploy is automatic and the runtime
does **not** migrate on boot.

## Smell patterns

- A PR adds a `NOT NULL` column to a table the code `SELECT`s, and the merge plan
  says "migrate prod **post-merge**."
- Trusting the deploy healthcheck to catch a schema mismatch.

## Why

- Merging to `main` **auto-deploys** to Railway (GitHub-connected service —
  confirmed PR #400: a new deploy started seconds after the merge and cut over
  the previous build).
- `server:prod` is `NODE_ENV=production node server_dist/index.js` — it runs **no
  `db:push` on boot**, so the deployed build does not self-migrate. The prod
  schema must already match the build's Drizzle schema.
- Drizzle compiles `db.select().from(table)` into an **explicit column list** from
  its schema. A build that declares a column prod lacks → every query touching
  that table throws `42703 undefined_column` → 500, **including login**.
- `/api/health` is only `SELECT 1` (never touches `users`), so it stays green
  while real requests fail — the deploy *looks* healthy.
- The expand/contract direction is asymmetric and that is the whole trick: the
  currently-running **old build is unaffected by columns added ahead of the
  deploy** (its column list predates them). So migrating prod first is
  zero-downtime; merging first guarantees an outage until a migration is
  scrambled in.

## Examples

The PR #400 sequence (add `users.email NOT NULL UNIQUE` + `email_verified`):

1. Inspect prod rows; decide drop-vs-backfill (backfill-in-place avoids deleting
   prod data — preferred even for test rows).
2. Apply targeted DDL in **one transaction**:
   ```sql
   BEGIN;
   ALTER TABLE users ADD COLUMN email_verified boolean DEFAULT false NOT NULL;
   ALTER TABLE users ADD COLUMN email text;                 -- nullable first
   UPDATE users SET email = '<addr>' WHERE email IS NULL;    -- backfill existing rows
   ALTER TABLE users ALTER COLUMN email SET NOT NULL;        -- now safe
   ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
   COMMIT;
   ```
3. Verify columns + constraint match Drizzle via `information_schema`; confirm the
   old build is still healthy.
4. Merge → the new deploy lands on the already-correct schema.
5. Verify the new build: a login probe for a non-existent user returns **401**
   (query path OK), not **500** (`42703`); a real login returns **200**.

Prod DB access from a laptop (the internal `postgres.railway.internal` host does
not resolve off-network — use the Postgres service's public proxy, value kept out
of stdout):

```bash
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f /tmp/mig.sql'
```

Prefer targeted `ALTER`/`UPDATE` over `drizzle-kit push` from a laptop — push
reconciles the **whole** schema (can apply unseen drift) and can prompt
interactively on `NOT NULL` adds. Match Drizzle's generated constraint names
(`{table}_{column}_unique`, e.g. `users_email_unique`) so a later `db:push` is a
no-op.

## Exceptions

- If the new column is nullable with a default and the code tolerates its
  absence, ordering is less critical — but auto-deploy still makes migrate-first
  the safe default.
- If a future change adds a boot-time migration step to `server:prod`, the
  runtime self-reconciles and this checklist relaxes — revisit then.

## Related Files

- `shared/schema.ts` — Drizzle column definitions (source of the deployed column list)
- `railway.json` — build/deploy config; note there is **no** migration step
- `package.json` — `server:prod` = `node server_dist/index.js` (no boot migration)
- `server/index.ts` — `/api/health` is `SELECT 1` (won't catch a schema mismatch)

## See Also

(none yet — first codified Railway deploy-ordering note)
