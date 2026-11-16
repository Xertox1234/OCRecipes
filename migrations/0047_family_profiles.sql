-- Family profiles (plan 2026-11-16): other people the user plans meals for, a
-- per-meal audience ('self' | 'shared' | 'profile') and the user's own switch.
-- A profile holds a name, allergies and a note: health data, never sent to an
-- AI provider. A meal's profile is tied to the same user by a composite foreign
-- key (family_profile_id, user_id) -> family_profiles (id, user_id), so a meal
-- can never point at another user's profile. Deleting a profile deletes its meals.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent: existing rows take the defaults ('self', false), and
-- the old server never reads the new table or columns.
-- (Follows 0046, the chat message reports.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0047_family_profiles.sql
--
-- Verify (paste the output; expect "true|2|1|1|5"):
--   psql "$DATABASE_URL" -Atc "SELECT (to_regclass('public.family_profiles') IS NOT NULL) || '|' || (SELECT count(*) FROM information_schema.columns WHERE table_name = 'meal_plan_items' AND column_name IN ('audience', 'family_profile_id')) || '|' || (SELECT count(*) FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'family_planning_enabled') || '|' || (SELECT count(*) FROM pg_constraint WHERE conname = 'meal_plan_items_family_profile_user_fk') || '|' || (SELECT count(*) FROM pg_constraint WHERE conname IN ('meal_plan_items_audience_check', 'meal_plan_items_audience_profile_check', 'family_profiles_name_check', 'family_profiles_note_check', 'family_profiles_id_user_id_unique'));"

BEGIN;

CREATE TABLE IF NOT EXISTS family_profiles (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  allergies jsonb NOT NULL DEFAULT '[]',
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT family_profiles_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  CONSTRAINT family_profiles_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT family_profiles_id_user_id_unique UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS family_profiles_user_sort_idx
  ON family_profiles (user_id, sort_order);

ALTER TABLE meal_plan_items ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'self';
ALTER TABLE meal_plan_items ADD COLUMN IF NOT EXISTS family_profile_id integer;

ALTER TABLE meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_audience_check;
ALTER TABLE meal_plan_items ADD CONSTRAINT meal_plan_items_audience_check
  CHECK (audience IN ('self', 'shared', 'profile'));

ALTER TABLE meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_audience_profile_check;
ALTER TABLE meal_plan_items ADD CONSTRAINT meal_plan_items_audience_profile_check
  CHECK ((audience = 'profile') = (family_profile_id IS NOT NULL));

ALTER TABLE meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_family_profile_user_fk;
ALTER TABLE meal_plan_items ADD CONSTRAINT meal_plan_items_family_profile_user_fk
  FOREIGN KEY (family_profile_id, user_id) REFERENCES family_profiles (id, user_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS meal_plan_items_family_profile_idx
  ON meal_plan_items (family_profile_id);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS family_planning_enabled boolean NOT NULL DEFAULT false;

COMMIT;
