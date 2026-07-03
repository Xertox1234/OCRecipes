---
title: Deploy before DROP COLUMN migration
track: knowledge
category: conventions
module: server
tags: [database, migration, drizzle, deploy-ordering, drop-column]
applies_to: [shared/schema.ts, migrations/**/*.sql]
created: '2026-06-10'
last_updated: '2026-06-10'
---

# Deploy before DROP COLUMN migration

## Rule

A destructive DDL migration (e.g., `DROP COLUMN`, `DROP TABLE`) must be applied to the production database **only after** the new server bundle that no longer references the dropped column or table is fully deployed. Never apply the migration before or simultaneously with the deploy.

## Why

Drizzle generates explicit `SELECT` column lists from the schema definition. When `getTableColumns(users)` or any schema-derived column list is used in a query, the compiled SQL names every column individually. If a column is dropped from the database but the currently-deployed server bundle still includes it in its schema, every query that selects from that table will fail with:

```
column "<column_name>" does not exist
```

For the `users` table, this causes a complete authentication outage — every login, session check, and user lookup crashes.

`DROP TABLE` has the same hazard via background jobs. If a table is dropped before the new server bundle (which no longer references it) is deployed, any still-running old bundle that performs periodic operations on that table — for example, a TTL janitor issuing `DELETE` queries — will fail with:

```
relation "<table_name>" does not exist
```

In the case of the `carousel_suggestion_cache` table, the `purgeExpiredCacheRows` function in `server/storage/cache.ts` executes a `DELETE` every 6 hours. If the table is dropped before the bundle that removes that janitor entry is live, every 6-hour cycle fails — the job's `.catch` keeps the server up, but the cleanup pass aborts at the missing table, so cache tables later in the list are never purged and the error log fills with `relation does not exist` until the new bundle deploys.

`DROP COLUMN IF EXISTS` and `DROP TABLE IF EXISTS` make the migration idempotent (safe to re-run) but do **not** make it ordering-safe. The ordering hazard is independent of idempotency: the problem is the mismatch between the deployed code's schema and the live database schema.

## Examples

The `migrations/0007_drop_adaptive_goals_columns.sql` migration demonstrates the correct pattern:

1. **Pre-flight count query** — Documented in the migration header so the operator can verify zero non-default rows exist before dropping:
   ```sql
   -- Pre-flight: verify no rows have non-default values
   -- SELECT count(*) FROM users
   -- WHERE adaptive_goals_enabled IS DISTINCT FROM false
   --    OR last_goal_adjustment_at IS NOT NULL;
   -- Expected: 0 (dev confirmed 0 non-default rows across 4853 users)
   ```

2. **Idempotent DROP** — Uses `IF EXISTS` so the migration can be re-run safely:
   ```sql
   ALTER TABLE users DROP COLUMN IF EXISTS adaptive_goals_enabled;
   ALTER TABLE users DROP COLUMN IF EXISTS last_goal_adjustment_at;
   ```

3. **Deploy ordering** — The migration is applied in a deploy window **after** the bundle that removed the columns from the schema is live.

The `migrations/0008_drop_carousel_suggestion_cache.sql` migration follows the same pattern:

1. **Pre-flight count query** — Verify no rows exist before dropping:
   ```sql
   -- Pre-flight: verify no rows exist
   -- SELECT count(*) FROM carousel_suggestion_cache;
   -- Expected: 0
   ```

2. **Idempotent DROP** — Uses `IF EXISTS`:
   ```sql
   DROP TABLE IF EXISTS carousel_suggestion_cache;
   ```

3. **Deploy ordering** — The migration is applied in a deploy window **after** the bundle that removed the table from the janitor's table list (and all other references) is live.

## Exceptions

- **Additive migrations** — `ADD COLUMN IF NOT EXISTS` is safe in either order. Adding a column the server doesn't yet use causes no errors; the server simply ignores it.
- **Dev database** — Running `db:push` or manual `psql` in a local development environment where the schema and database are edited in the same session is fine. The rule applies to production deploys where the server bundle and database migration are applied asynchronously.
- **Older migrations** — After a `DROP COLUMN` migration is applied, any older migration that references the dropped column (e.g., `migrations/0002` line 22) will fail if replayed. This is expected and acceptable — migrations are applied in order and never re-run from scratch in production.

## Related Files

- `migrations/0007_drop_adaptive_goals_columns.sql`
- `migrations/0008_drop_carousel_suggestion_cache.sql`
- `shared/schema.ts`
- `server/storage/users.ts`
- `server/storage/export.ts`
- `server/storage/cache.ts`

## See Also

- [drizzle-notnull-schema-vs-db-enforcement-gap-2026-06-02.md](drizzle-notnull-schema-vs-db-enforcement-gap-2026-06-02.md)
