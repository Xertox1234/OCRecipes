---
title: 'A column backfilled from another column in one UPDATE must live on that column''s table — verify table ownership against the live DB, not the spec'
track: knowledge
category: conventions
module: shared
tags: [migration, backfill, drizzle, jsonb, schema, expand-contract, user_profiles, postgres]
applies_to: [migrations/*.sql, shared/schema.ts, server/storage/*-backfill.ts]
created: '2026-06-26'
---

# A column backfilled from another column in one UPDATE must live on that column's table — verify table ownership against the live DB, not the spec

## Rule

When a new column is backfilled from an existing column in a **single-statement** `UPDATE ... SET new_col = f(old_col)`, the new column **must be added to the same table** that holds `old_col`. A single statement cannot read `old_col` from table A while writing `new_col` on table B without a join + a separate default for rows that don't join. So: before you place the new column, confirm which table actually owns the source column **by querying the live schema**, not by trusting the spec, the plan, or a memory note.

```sql
-- authoritative: ask the DB, not the doc
SELECT table_name FROM information_schema.columns WHERE column_name = 'reminder_mutes';
```

## Why

A spec or plan often refers to a column by an assumed owner (`users.reminderMutes`) when it actually lives elsewhere (`user_profiles.reminder_mutes`). If you co-locate the new column based on the wrong table, the verbatim backfill silently targets a non-existent source:

```sql
-- WRONG: notification_prefs added to users, but reminder_mutes is on user_profiles
UPDATE users SET notification_prefs = jsonb_build_object('categories', reminder_mutes, ...);
-- ERROR 42703: column "reminder_mutes" does not exist
```

Co-location also buys behavioral correctness for free: in this codebase the mute read-path is `profile?.reminderMutes`, so putting `notificationPrefs` on the same `user_profiles` row means Phase-1 reads inherit the same optional-profile handling — no new join, no separate default for profile-less users. The table label was the only thing wrong in the plan; co-locating preserved the intended architecture.

## Examples

`migrations/0011_notification_phase0.sql` — the new `notification_prefs` jsonb column and its backfill both target `user_profiles` (where `reminder_mutes` lives), enabling a single idempotent statement:

```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE user_profiles
SET notification_prefs = jsonb_build_object(
  'categories', reminder_mutes,             -- verbatim copy: no inversion, no key rename
  'quietHours', jsonb_build_object('start', '21:00', 'end', '08:00'),
  'ambientPush', false,
  'transactionalEnabled', true
)
WHERE notification_prefs = '{}'::jsonb;       -- idempotent: re-run touches only un-backfilled rows
```

The backfill is **verbatim** (`'categories', reminder_mutes` — no boolean inversion, no key remap), so a test that seeds `reminder_mutes = {"meal-log": true}` and asserts `categories === {"meal-log": true}` is falsifiable against an accidental transform.

## Exceptions

- If the source and target genuinely belong on different tables (a real normalization boundary), the backfill is **not** single-statement — it needs an explicit `UPDATE ... FROM <source> WHERE ...` join *and* a fallback default for target rows with no matching source row. Prefer co-location unless a normalization reason forbids it.
- A column whose default differs per-row (not a constant) can't be a pure `DEFAULT` + idempotent `WHERE x = '{}'` backfill; it needs the join form.

## Related Files

- `migrations/0011_notification_phase0.sql` — co-located column + verbatim idempotent backfill
- `server/storage/notification-prefs-backfill.ts` — the runtime mirror of the migration's `UPDATE`
- `shared/schema.ts` — `notificationPrefs` placed inside the `userProfiles` table, beside `reminderMutes`

## See Also

- [notNull-default column ripples to $inferSelect](../code-quality/notnull-default-column-ripples-to-inferselect-not-inferinsert-2026-06-26.md) — the type-side blast radius of the same column addition
