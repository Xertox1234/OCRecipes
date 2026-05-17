# Design: Migrate all timestamp columns to `timestamptz`

- **Date:** 2026-05-16
- **Todo:** `todos/2026-03-27-timestamp-timezone-consistency.md` (audit finding M4)
- **Status:** Approved, ready for implementation plan

## Problem

`shared/schema.ts` has 79 timestamp columns. 78 use `timestamp("col")` (PostgreSQL
`timestamp without time zone`); only `savedItems.createdAt` uses
`timestamp("col", { withTimezone: true })` (`timestamptz`). This single outlier is
an inconsistency flagged by the 2026-03-27 full audit (M4).

The practical correctness risk is currently low: `server/db.ts:20` pins the app
pool's PostgreSQL session timezone to UTC (`options: "-c timezone=UTC"`), so naked
`timestamp` columns behave equivalently to `timestamptz` for this app's read/write
paths. However, the todo's stated preference and the `schema.ts` `TODO` comment both
call for standardizing on `timestamptz` (the PostgreSQL best-practice default for
UTC-aware storage). This spec does that.

## Decision

Migrate **all** timestamp columns to `{ withTimezone: true }` (`timestamptz`), rather
than reverting the one outlier to naked `timestamp`.

## Why the conversion is data-safe

`ALTER COLUMN ... TYPE timestamptz` reinterprets each existing naked timestamp as
being in the **session's** `timezone` setting, then stores the UTC equivalent.
Because the app has always written UTC values, the conversion is a no-op data-wise
**provided the migration session runs with `timezone='UTC'`**.

PostgreSQL 12+ additionally **skips the table rewrite** for `timestamp → timestamptz`
when the session `TimeZone` is `UTC` — the on-disk byte representation is identical.
So a UTC-pinned migration is both _correct_ (no time shift) and _fast_ (brief locks,
no full rewrite of large tables).

This is why the conversion must be a **hand-written SQL migration**, not
`drizzle-kit push`: `db:push` connects via `drizzle.config.ts`, which has **no UTC
session pin**, so its auto-generated `ALTER` would interpret stored values under
whatever the connecting role's default timezone happens to be — silently shifting
data if that default is not UTC.

## Changes

### 1. Schema (`shared/schema.ts`)

Every `timestamp("col_name")` becomes `timestamp("col_name", { withTimezone: true })`
(78 columns). Applied via a one-off regex transform that matches only the 1-argument
form, so the already-2-argument `savedItems.createdAt` is left untouched. `.notNull()`
and `.default(...)` chains are unaffected (the option object is the second argument to
`timestamp()`, before any chained calls).

Remove the now-resolved tracking comment at `schema.ts:363-365`
(the `// TODO: Migrate all timestamp columns ...` block).

### 2. Migration — `migrations/0002_timestamps_to_timestamptz.sql`

A hand-written SQL file, applied manually like the existing
`migrations/0001_enable_pg_trgm.sql`:

```sql
-- Convert all timestamp columns to timestamptz (todo M4 / timezone consistency).
-- MUST run before `npm run db:push` picks up the schema.ts change — db:push would
-- otherwise generate an un-pinned ALTER and risk shifting data.
BEGIN;
SET LOCAL timezone = 'UTC';
ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz;
-- … one bare ALTER per timestamp column (78 total; savedItems.created_at already
--    timestamptz — re-applying is a harmless no-op, so it may be included or skipped) …
COMMIT;
```

- `SET LOCAL timezone = 'UTC'` guarantees correct interpretation regardless of who
  runs the file, and triggers the PG12 no-rewrite fast path.
- **Bare** `ALTER ... TYPE timestamptz` (no `USING` clause) is required to keep the
  no-rewrite fast path; the implicit assignment cast under a UTC session does the
  right thing.
- Single transaction = atomic all-or-nothing.
- Safe to re-run: re-applying to an already-`timestamptz` column is a no-op.

### 3. Comment cleanup (`server/db.ts:16-20`)

Reword the pool-options comment — its current wording describes "interpreting
`timestamp` (without timezone) columns", which goes stale once all columns are
`timestamptz`. **Keep the UTC session pin** (`options: "-c timezone=UTC"`): it still
keeps `CURRENT_TIMESTAMP` default values consistent and is harmless. The reworded
comment should explain the pin now primarily guards default-value consistency.

## Rollout procedure

1. **Existing populated DBs (production, populated local dev):** run the SQL file
   first — e.g. `psql "$DATABASE_URL" -f migrations/0002_timestamps_to_timestamptz.sql`.
2. **Then `npm run db:push`** — it must report **zero drift**, confirming `schema.ts`
   matches the DB. `db:push` here only _confirms_ the conversion; it never _performs_
   it.
3. **Fresh DBs** (the SessionStart-hook test Postgres, new installs): just
   `npm run db:push` — columns are created as `timestamptz` directly; the SQL file is
   not needed.

The PR description documents step 1 as a required manual step before deploy.

## Testing & verification

- **No app-code changes expected.** Drizzle returns a JS `Date` for both naked
  `timestamp` and `timestamptz`; since stored values are already UTC, round-tripped
  `Date` values are unchanged. CI's existing test suite (~3400 tests) is the
  regression check.
- Post-migration verification query — must return `0`:
  ```sql
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND data_type = 'timestamp without time zone';
  ```

## Risks & mitigations

- **Stale-DB `db:push` footgun:** a developer who pulls the schema change and runs
  `db:push` _before_ applying the SQL file would have `db:push` generate its own
  un-pinned `ALTER`. _Mitigation:_ a loud header comment in the SQL file and an
  explicit note in the PR description. Local dev DBs hold throwaway data, so blast
  radius is low; production is protected by the documented procedure.
- **Lock duration:** ~78 `ACCESS EXCLUSIVE` locks held until `COMMIT`. With the
  no-rewrite fast path each `ALTER` is sub-second, so the total transaction is short.
  Acceptable in a brief maintenance window. If a zero-maintenance-window deploy is
  later required, the transaction can be split per-table — out of scope here.

## Out of scope

- Switching the project from `drizzle-kit push` to a generated-migration workflow.
- Per-table / batched migration for zero-downtime deploys.
- Any change to `date`-typed (non-timestamp) columns.

## Acceptance criteria

- [ ] All 79 timestamp columns in `shared/schema.ts` use `{ withTimezone: true }`.
- [ ] `migrations/0002_timestamps_to_timestamptz.sql` exists, converts all columns
      under a `SET LOCAL timezone='UTC'` transaction, and carries the header warning.
- [ ] The `schema.ts:363-365` tracking comment is removed.
- [ ] The `server/db.ts` pool-options comment is reworded; the UTC pin is kept.
- [ ] Verification query returns `0` after migration on a populated DB.
- [ ] Existing test suite passes (CI).
