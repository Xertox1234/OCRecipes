# Timestamp Timezone Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert all 77 naked `timestamp` columns in `shared/schema.ts` to `timestamptz` (`{ withTimezone: true }`) so the whole schema uses one timezone-aware strategy.

**Architecture:** A hand-written SQL migration (`migrations/0002_*.sql`) does the column type changes under a `SET LOCAL timezone='UTC'` transaction — correct and rewrite-free on PG12+. The two `DATE()` expression indexes are rewritten to an immutable `DATE(col AT TIME ZONE 'UTC')` form (because `DATE(timestamptz)` is not `IMMUTABLE`), and the matching `ON CONFLICT` clauses in `server/storage/health.ts` move in lockstep. The Drizzle schema is updated so fresh `db:push` produces the same result.

**Tech Stack:** PostgreSQL, Drizzle ORM, drizzle-kit (`db:push`), Vitest, TypeScript.

**Reference spec:** `docs/superpowers/specs/2026-05-16-timestamp-timezone-consistency-design.md`

---

## File Structure

- **Create** `migrations/0002_timestamps_to_timestamptz.sql` — the manual migration for existing populated databases.
- **Modify** `shared/schema.ts` — 77 columns gain `{ withTimezone: true }`; 2 expression indexes gain `AT TIME ZONE 'UTC'`; remove the resolved tracking comment.
- **Modify** `server/storage/health.ts` — 2 raw-SQL `ON CONFLICT` clauses + 1 comment.
- **Modify** `server/storage/__tests__/weight-log-dedup.test.ts` — 2 assertions (the TDD anchor).
- **Modify** `server/db.ts` — reword the pool-options comment (cosmetic).

---

## Task 1: Add the migration SQL file

Purely additive — creating this file changes no runtime behavior. It is applied manually against existing populated databases (production, populated local dev) before `db:push` picks up the schema change.

**Files:**

- Create: `migrations/0002_timestamps_to_timestamptz.sql`

- [ ] **Step 1: Create the migration file**

Create `migrations/0002_timestamps_to_timestamptz.sql` with exactly this content:

```sql
-- Convert all timestamp columns to timestamptz (todo M4 / timezone consistency).
--
-- WARNING: This file MUST be run before `npm run db:push` picks up the
-- shared/schema.ts change. db:push connects without a UTC session pin, so its
-- auto-generated ALTER could interpret stored values under a non-UTC timezone
-- and silently shift data. This file pins the session to UTC explicitly.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0002_timestamps_to_timestamptz.sql
-- Safe to re-run: ALTER on an already-timestamptz column is a no-op, and the
-- DROP/CREATE INDEX pair is idempotent.

BEGIN;
SET LOCAL timezone = 'UTC';

-- Drop the two DATE() expression indexes first. ALTER COLUMN TYPE would
-- otherwise try to rebuild them as DATE(timestamptz), which fails because
-- DATE(timestamptz) is STABLE, not IMMUTABLE.
DROP INDEX IF EXISTS pending_reminders_user_type_day_idx;
DROP INDEX IF EXISTS weight_logs_user_date_idx;

ALTER TABLE users ALTER COLUMN goals_calculated_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN last_goal_adjustment_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN subscription_expires_at TYPE timestamptz;
ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN health_data_consent_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE user_profiles ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN scheduled_for TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN acknowledged_at TYPE timestamptz;
ALTER TABLE pending_reminders ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE scanned_items ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE scanned_items ALTER COLUMN discarded_at TYPE timestamptz;
ALTER TABLE daily_logs ALTER COLUMN logged_at TYPE timestamptz;
ALTER TABLE nutrition_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE nutrition_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE micronutrient_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE micronutrient_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE instruction_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE favourite_scanned_items ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE favourite_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN canonicalized_at TYPE timestamptz;
ALTER TABLE community_recipes ALTER COLUMN canonical_enriched_at TYPE timestamptz;
ALTER TABLE recipe_generation_log ALTER COLUMN generated_at TYPE timestamptz;
ALTER TABLE taste_picks ALTER COLUMN picked_at TYPE timestamptz;
ALTER TABLE meal_plan_recipes ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE meal_plan_recipes ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE meal_plan_items ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE weight_logs ALTER COLUMN logged_at TYPE timestamptz;
ALTER TABLE healthkit_sync ALTER COLUMN last_sync_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN pinned_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE chat_conversations ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE chat_messages ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE fasting_logs ALTER COLUMN started_at TYPE timestamptz;
ALTER TABLE fasting_logs ALTER COLUMN ended_at TYPE timestamptz;
ALTER TABLE medication_logs ALTER COLUMN taken_at TYPE timestamptz;
ALTER TABLE menu_scans ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE receipt_scans ALTER COLUMN scanned_at TYPE timestamptz;
ALTER TABLE goal_adjustment_logs ALTER COLUMN applied_at TYPE timestamptz;
ALTER TABLE transactions ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE transactions ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE grocery_lists ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE grocery_lists ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE grocery_list_items ALTER COLUMN checked_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN added_at TYPE timestamptz;
ALTER TABLE pantry_items ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE meal_suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE meal_suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE coach_response_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE coach_response_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN follow_up_date TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE coach_notebook ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE cookbooks ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE cookbooks ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE cookbook_recipes ALTER COLUMN added_at TYPE timestamptz;
ALTER TABLE barcode_verifications ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE barcode_verifications ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE verification_history ALTER COLUMN front_label_scanned_at TYPE timestamptz;
ALTER TABLE verification_history ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE reformulation_flags ALTER COLUMN detected_at TYPE timestamptz;
ALTER TABLE reformulation_flags ALTER COLUMN resolved_at TYPE timestamptz;
ALTER TABLE api_keys ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE api_keys ALTER COLUMN revoked_at TYPE timestamptz;
ALTER TABLE api_key_usage ALTER COLUMN last_request_at TYPE timestamptz;
ALTER TABLE barcode_nutrition ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE barcode_nutrition ALTER COLUMN updated_at TYPE timestamptz;
ALTER TABLE recipe_dismissals ALTER COLUMN dismissed_at TYPE timestamptz;
ALTER TABLE carousel_suggestion_cache ALTER COLUMN expires_at TYPE timestamptz;
ALTER TABLE carousel_suggestion_cache ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE push_tokens ALTER COLUMN created_at TYPE timestamptz;
ALTER TABLE push_tokens ALTER COLUMN updated_at TYPE timestamptz;

-- Recreate the expression indexes with the immutable, UTC-zoned expression.
CREATE UNIQUE INDEX pending_reminders_user_type_day_idx
  ON pending_reminders (user_id, type, DATE(scheduled_for AT TIME ZONE 'UTC'))
  WHERE acknowledged_at IS NULL;
CREATE UNIQUE INDEX weight_logs_user_date_idx
  ON weight_logs (user_id, DATE(logged_at AT TIME ZONE 'UTC'));

COMMIT;
```

- [ ] **Step 2: Sanity-check the file**

Run: `grep -c '^ALTER TABLE' migrations/0002_timestamps_to_timestamptz.sql`
Expected: `77`

Run: `grep -c 'CREATE UNIQUE INDEX' migrations/0002_timestamps_to_timestamptz.sql`
Expected: `2`

- [ ] **Step 3: Commit**

```bash
git add migrations/0002_timestamps_to_timestamptz.sql
git commit -m "feat(db): add migration to convert timestamp columns to timestamptz"
```

---

## Task 2: Migrate schema + storage to timestamptz

This is the atomic change. The 77 column conversions, the 2 index-expression fixes, and the 2 `ON CONFLICT` clause changes in `health.ts` **must ship in one commit** — any partial state either breaks a fresh `db:push` or breaks weight-log upserts at runtime. Start with the test (TDD), since `weight-log-dedup.test.ts` already asserts the old `ON CONFLICT` expression.

**Files:**

- Modify: `server/storage/__tests__/weight-log-dedup.test.ts`
- Modify: `server/storage/health.ts:40,52,77`
- Modify: `shared/schema.ts` (77 columns + indexes at `123` and `946` + comment at `363-365`)

- [ ] **Step 1: Update the failing test assertions**

In `server/storage/__tests__/weight-log-dedup.test.ts` there are **two** occurrences of:

```ts
expect(text).toContain("DATE(logged_at)");
```

Change **both** to:

```ts
expect(text).toContain("DATE(logged_at AT TIME ZONE 'UTC')");
```

(They are in the `includes ON CONFLICT clause targeting date-keyed index` test and the `calls tx.execute with the same ON CONFLICT clause` test.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/storage/__tests__/weight-log-dedup.test.ts`
Expected: FAIL — 2 assertions fail because `health.ts` still emits `DATE(logged_at)` (the substring `DATE(logged_at AT TIME ZONE 'UTC')` is not present).

- [ ] **Step 3: Update the `ON CONFLICT` clauses in `health.ts`**

In `server/storage/health.ts`, both `createWeightLog` (line ~52) and `createWeightLogAndUpdateUser` (line ~77) contain the identical clause text `ON CONFLICT (user_id, DATE(logged_at))`. Replace **all** occurrences:

`ON CONFLICT (user_id, DATE(logged_at))` → `ON CONFLICT (user_id, DATE(logged_at AT TIME ZONE 'UTC'))`

(With the Edit tool: `old_string` = `ON CONFLICT (user_id, DATE(logged_at))`, `new_string` = `ON CONFLICT (user_id, DATE(logged_at AT TIME ZONE 'UTC'))`, `replace_all: true` — the surrounding indentation differs between the two call sites, so match on the un-indented clause text.)

Then update the explanatory comment at `health.ts:40`:

```ts
// The unique index keys on (user_id, DATE(logged_at)) -- a functional index
```

becomes:

```ts
// The unique index keys on (user_id, DATE(logged_at AT TIME ZONE 'UTC')) -- a functional index
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/storage/__tests__/weight-log-dedup.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Convert the 77 timestamp columns in `shared/schema.ts`**

Run this in-place regex transform. It matches only the **1-argument** form `timestamp("name")`, so the already-2-argument `savedItems.createdAt` (`timestamp("created_at", { withTimezone: true })`) is left untouched:

```bash
perl -i -pe 's/timestamp\("([a-z0-9_]+)"\)/timestamp("$1", { withTimezone: true })/g' shared/schema.ts
```

- [ ] **Step 6: Verify the transform**

Run: `grep -oE 'withTimezone: true' shared/schema.ts | wc -l`
Expected: `78` (77 newly converted + the 1 pre-existing `savedItems.createdAt`).

Run: `grep -cE 'timestamp\("[a-z0-9_]+"\)' shared/schema.ts`
Expected: `0` (no 1-argument `timestamp()` calls remain).

- [ ] **Step 7: Fix the two `DATE()` expression indexes in `shared/schema.ts`**

`DATE(timestamptz)` is `STABLE`, not `IMMUTABLE`, so an index on it is invalid. Add an explicit literal zone.

At the `pending_reminders` table (around line 123), change:

```ts
      .on(table.userId, table.type, sql`DATE(${table.scheduledFor})`)
```

to:

```ts
      .on(
        table.userId,
        table.type,
        sql`DATE(${table.scheduledFor} AT TIME ZONE 'UTC')`,
      )
```

At the `weight_logs` table (around line 946), change:

```ts
      sql`DATE(${table.loggedAt})`,
```

to:

```ts
      sql`DATE(${table.loggedAt} AT TIME ZONE 'UTC')`,
```

- [ ] **Step 8: Remove the resolved tracking comment in `shared/schema.ts`**

In the `saved_items` table, replace this 3-line comment block (around line 363):

```ts
// Metadata — withTimezone intentionally kept to preserve existing timestamptz column.
// TODO: Migrate all timestamp columns to withTimezone for consistency.
//   Tracked: todos/2026-03-27-timestamp-timezone-consistency.md
```

with a single line:

```ts
// Metadata
```

- [ ] **Step 9: Type-check**

Run: `npm run check:types`
Expected: PASS — `{ withTimezone: true }` is a valid `timestamp()` option and the `sql` template edits are well-typed.

- [ ] **Step 10: Run the full test suite**

Run: `npm run test:run`
Expected: PASS. The `weight-log-dedup.test.ts` tests pass (Step 4). Other tests are unaffected: Drizzle returns a JS `Date` for both `timestamp` and `timestamptz`, and stored values are already UTC, so round-tripped values are unchanged.

If any DB-integrated test fails because the local test database still has naked `timestamp` columns, apply the migration to it first: `psql "$DATABASE_URL" -f migrations/0002_timestamps_to_timestamptz.sql`, then re-run.

- [ ] **Step 11: Commit**

```bash
git add shared/schema.ts server/storage/health.ts server/storage/__tests__/weight-log-dedup.test.ts
git commit -m "feat(db): convert all timestamp columns to timestamptz"
```

---

## Task 3: Reword the `server/db.ts` pool-options comment

Cosmetic only — no behavior change. The current comment describes interpreting naked `timestamp` columns, which is stale once every column is `timestamptz`. The UTC session pin itself stays.

**Files:**

- Modify: `server/db.ts:16-20`

- [ ] **Step 1: Reword the comment**

In `server/db.ts`, replace:

```ts
  // Drizzle ORM interprets timestamp (without timezone) columns as UTC
  // (appends +0000 on read, sends toISOString() on write). We must ensure
  // PostgreSQL's session timezone matches so that CURRENT_TIMESTAMP defaults
  // also produce UTC values, preventing day-boundary mismatches.
  options: "-c timezone=UTC",
```

with:

```ts
  // Pin the session timezone to UTC. All timestamp columns are timestamptz, so
  // values round-trip in UTC regardless; this pin keeps CURRENT_TIMESTAMP
  // column defaults consistent and guards any future naked `timestamp` column.
  options: "-c timezone=UTC",
```

- [ ] **Step 2: Type-check**

Run: `npm run check:types`
Expected: PASS (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add server/db.ts
git commit -m "docs(db): reword pool-options comment for timestamptz schema"
```

---

## Post-implementation: deploy & verification

Not a code task — done at deploy time, documented in the PR description.

1. **On each existing populated database** (production, populated local/dev), run the migration **before** deploying the schema change:
   ```bash
   psql "$DATABASE_URL" -f migrations/0002_timestamps_to_timestamptz.sql
   ```
2. **Then** run `npm run db:push` — it must report **zero drift**, confirming `shared/schema.ts` matches the database.
   - _Known quirk:_ drizzle-kit's diffing of **expression** indexes is textual and can be twitchy — `db:push` may still propose a DROP/CREATE of `pending_reminders_user_type_day_idx` / `weight_logs_user_date_idx` even when they are already correct (the round-tripped `pg_get_indexdef` text may not byte-match the `sql\`…\`` template output). If drift is reported **only** on those two indexes and they are functionally identical, it is benign — accept or ignore it; do not treat it as a column-conversion failure.
3. **Verification query** — must return `0`:
   ```sql
   SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND data_type = 'timestamp without time zone';
   ```
   A non-zero result means a column was missed (the migration's `ALTER` list is hand-derived from `schema.ts`) — add the missing `ALTER` to the migration and re-run.
4. **Fresh databases** (the SessionStart-hook test Postgres, new installs) need only `npm run db:push` — columns and the corrected index expressions are created directly from `schema.ts`.

The PR description must call out step 1 as a required manual step before deploy.

---

## Self-Review

**Spec coverage:**

- "All timestamp columns use the same strategy" → Task 2 Steps 5-6 (77 columns) + Task 1 (migration). ✓
- "Migration handles existing data correctly" → Task 1 (`SET LOCAL timezone='UTC'`, no-rewrite fast path). ✓
- "Existing tests pass" → Task 2 Step 10. ✓
- Expression index immutability → Task 2 Step 7 + Task 1 (DROP/CREATE INDEX). ✓
- `ON CONFLICT` lockstep → Task 2 Steps 1-4. ✓
- `db.ts` comment reword, UTC pin kept → Task 3. ✓
- Tracking comment removed → Task 2 Step 8. ✓
- Verification query returns 0 → Post-implementation step 3. ✓

**Placeholder scan:** No TBD/TODO; the full 77-line `ALTER` list and every edit's before/after text are inline. ✓

**Type consistency:** `{ withTimezone: true }`, `AT TIME ZONE 'UTC'`, and `DATE(logged_at AT TIME ZONE 'UTC')` are used identically across the schema, migration, `health.ts`, and the test. ✓

**Codebase-wide raw-SQL date check (done during planning):**
`grep -rnE 'DATE\(|date_trunc\(|EXTRACT\(|::date' server/ client/ shared/ --include='*.ts'`
(excluding tests) found no `DATE(naked_column)` raw SQL beyond what this plan
already covers. The only other hit — `server/storage/verification.ts:93,96` — already
wraps its columns as `DATE(col AT TIME ZONE 'UTC')`, which yields the correct UTC
calendar date for both `timestamp` and `timestamptz`, so it needs **no change**. ✓
