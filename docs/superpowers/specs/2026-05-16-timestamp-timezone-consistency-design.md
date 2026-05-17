# Design: Migrate all timestamp columns to `timestamptz`

- **Date:** 2026-05-16
- **Todo:** `todos/2026-03-27-timestamp-timezone-consistency.md` (audit finding M4)
- **Status:** Approved, ready for implementation plan

## Problem

`shared/schema.ts` has 78 timestamp columns. 77 use `timestamp("col")` (PostgreSQL
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

## Expression index immutability

Two `uniqueIndex` definitions use a `DATE(timestamp_column)` expression:
`pending_reminders_user_type_day_idx` (`schema.ts:122-124`, on `DATE(scheduled_for)`)
and `weight_logs_user_date_idx` (`schema.ts:944-947`, on `DATE(logged_at)`).

`DATE(timestamp without time zone)` is `IMMUTABLE`, but `DATE(timestamptz)` is only
`STABLE` — it depends on the session `TimeZone`. PostgreSQL rejects non-immutable
expressions in index definitions. So once these columns become `timestamptz`:

- `ALTER COLUMN ... TYPE timestamptz` fails when it tries to rebuild the dependent
  expression index, and
- a fresh `db:push` fails to create the index.

The fix is an explicitly-zoned, immutable expression: `DATE(col AT TIME ZONE 'UTC')`.
`timestamptz AT TIME ZONE 'UTC'` yields a `timestamp without time zone`, and with a
literal zone the whole expression is immutable. UTC is the correct zone —
`getDayBounds()` in `server/storage/helpers.ts` defines day boundaries with
`setUTCHours`, and `coach-pro-chat.ts` buckets days in UTC. The corrected expression
preserves the existing "one row per UTC calendar day" semantics exactly.

## Changes

### 1. Schema (`shared/schema.ts`)

Every `timestamp("col_name")` becomes `timestamp("col_name", { withTimezone: true })`
(77 columns). Applied via a one-off regex transform that matches only the 1-argument
form, so the already-2-argument `savedItems.createdAt` is left untouched. `.notNull()`
and `.default(...)` chains are unaffected (the option object is the second argument to
`timestamp()`, before any chained calls).

Both `DATE(...)` expression indexes change to the immutable, UTC-zoned form (see
"Expression index immutability" above):

- `schema.ts:123` — `sql\`DATE(${table.scheduledFor})\`` →
  `sql\`DATE(${table.scheduledFor} AT TIME ZONE 'UTC')\``
- `schema.ts:946` — `sql\`DATE(${table.loggedAt})\`` →
  `sql\`DATE(${table.loggedAt} AT TIME ZONE 'UTC')\``

Remove the now-resolved tracking comment at `schema.ts:363-365`
(the `// TODO: Migrate all timestamp columns ...` block).

### 2. App code (`server/storage/health.ts`)

`createWeightLog` and `createWeightLogAndUpdateUser` upsert via raw SQL with
`ON CONFLICT (user_id, DATE(logged_at))` (`health.ts:52` and `health.ts:77`). An
`ON CONFLICT` arbiter expression must match the target index expression **exactly**,
so both change to `ON CONFLICT (user_id, DATE(logged_at AT TIME ZONE 'UTC'))`. If they
are not updated in lockstep with the index, the upserts fail at runtime with
`there is no unique or exclusion constraint matching the ON CONFLICT specification`.
Update the explanatory comment at `health.ts:40` to match.

`server/storage/reminders.ts` needs no change: its insert uses an untargeted
`.onConflictDoNothing()` (no arbiter expression to match), and `hasPendingReminderToday()`
filters with a `gte`/`lt` range on `scheduledFor`, not a `DATE()` expression — both
work unchanged on `timestamptz`.

### 3. Migration — `migrations/0002_timestamps_to_timestamptz.sql`

A hand-written SQL file, applied manually like the existing
`migrations/0001_enable_pg_trgm.sql`:

```sql
-- Convert all timestamp columns to timestamptz (todo M4 / timezone consistency).
-- MUST run before `npm run db:push` picks up the schema.ts change — db:push would
-- otherwise generate an un-pinned ALTER and risk shifting data.
BEGIN;
SET LOCAL timezone = 'UTC';

-- Drop the two DATE() expression indexes first: ALTER COLUMN TYPE would otherwise
-- try to rebuild them as DATE(timestamptz), which fails the immutability check.
DROP INDEX IF EXISTS pending_reminders_user_type_day_idx;
DROP INDEX IF EXISTS weight_logs_user_date_idx;

ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz;
-- … one bare ALTER per timestamp column (77 total; savedItems.created_at already
--    timestamptz — re-applying is a harmless no-op, so it may be included or skipped) …

-- Recreate the expression indexes with the immutable, UTC-zoned expression.
CREATE UNIQUE INDEX pending_reminders_user_type_day_idx
  ON pending_reminders (user_id, type, DATE(scheduled_for AT TIME ZONE 'UTC'))
  WHERE acknowledged_at IS NULL;
CREATE UNIQUE INDEX weight_logs_user_date_idx
  ON weight_logs (user_id, DATE(logged_at AT TIME ZONE 'UTC'));
COMMIT;
```

- `SET LOCAL timezone = 'UTC'` guarantees correct interpretation regardless of who
  runs the file, and triggers the PG12 no-rewrite fast path.
- **Bare** `ALTER ... TYPE timestamptz` (no `USING` clause) is required to keep the
  no-rewrite fast path; the implicit assignment cast under a UTC session does the
  right thing.
- Only the two `DATE()` expression indexes need an explicit drop/recreate. The other
  plain b-tree indexes on timestamp columns are rebuilt automatically by
  `ALTER COLUMN TYPE` — b-tree ordering on `timestamptz` raises no immutability issue.
- Single transaction = atomic all-or-nothing.
- Safe to re-run: re-applying `ALTER` to an already-`timestamptz` column is a no-op,
  and the `DROP INDEX IF EXISTS` / `CREATE UNIQUE INDEX` pair re-establishes the
  indexes idempotently.

### 4. Comment cleanup (`server/db.ts:16-20`)

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
   `npm run db:push` — columns are created as `timestamptz` directly and the two
   expression indexes are emitted with the corrected `DATE(... AT TIME ZONE 'UTC')`
   form straight from `schema.ts`; the SQL file is not needed.

The PR description documents step 1 as a required manual step before deploy.

## Testing & verification

- **App-code change is minimal and localized.** The only runtime-logic edit is the
  two `ON CONFLICT` expressions in `server/storage/health.ts`; everything else is the
  schema file and the SQL migration. Drizzle returns a JS `Date` for both naked
  `timestamp` and `timestamptz`, and stored values are already UTC, so round-tripped
  `Date` values are unchanged.
- The weight-log upsert path (`createWeightLog`, `createWeightLogAndUpdateUser`) and
  the reminder per-day uniqueness path are the highest-risk spots — confirm existing
  tests cover same-day upsert collapsing to one row, and add coverage if missing.
- CI's existing test suite (~3400 tests) is the regression check.
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
- **Lock duration:** ~77 `ACCESS EXCLUSIVE` locks held until `COMMIT`. With the
  no-rewrite fast path each `ALTER` is sub-second, so the total transaction is short.
  Acceptable in a brief maintenance window. If a zero-maintenance-window deploy is
  later required, the transaction can be split per-table — out of scope here.
- **Index / `ON CONFLICT` expression drift:** the `health.ts` `ON CONFLICT` clauses
  and the `weight_logs_user_date_idx` expression must change together — shipping one
  without the other breaks weight-log upserts at runtime. Mitigation: both live in
  the same PR and are pinned by the acceptance criteria below.

## Out of scope

- Switching the project from `drizzle-kit push` to a generated-migration workflow.
- Per-table / batched migration for zero-downtime deploys.
- Any change to `date`-typed (non-timestamp) columns.

## Acceptance criteria

- [ ] All 78 timestamp columns in `shared/schema.ts` use `{ withTimezone: true }`.
- [ ] Both `DATE()` expression indexes in `schema.ts` use the
      `DATE(col AT TIME ZONE 'UTC')` immutable form.
- [ ] `health.ts` `ON CONFLICT` clauses (lines 52, 77) and the comment at line 40 use
      the `DATE(logged_at AT TIME ZONE 'UTC')` form.
- [ ] `migrations/0002_timestamps_to_timestamptz.sql` exists, converts all columns
      under a `SET LOCAL timezone='UTC'` transaction, carries the header warning, and
      drops/recreates the two expression indexes around the column ALTERs.
- [ ] The `schema.ts:363-365` tracking comment is removed.
- [ ] The `server/db.ts` pool-options comment is reworded; the UTC pin is kept.
- [ ] Verification query returns `0` after migration on a populated DB.
- [ ] Existing test suite passes (CI).
