-- Cookbook cover studio (2026-10-31). Two tables for the New Cookbook flow's
-- AI cover studio:
--   cookbook_cover_candidates      — generated covers waiting to be picked
--                                    (2 h expiry; the hourly purge deletes the
--                                    rows and their stored objects).
--   cookbook_cover_generation_log  — one row per stored set; the daily cap's
--                                    counter (candidates are deleted, so they
--                                    cannot count).
-- Both cascade from users, like every user-owned table.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- routes, the hourly purge, and account deletion all query these tables, so
-- the purge logs errors and account deletion fails until they exist.
-- Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0032_cookbook_cover_studio.sql
--
-- Verify (paste the output; expect both names, not NULL):
--   psql "$DATABASE_URL" -c "SELECT to_regclass('public.cookbook_cover_candidates'), to_regclass('public.cookbook_cover_generation_log');"

BEGIN;

CREATE TABLE IF NOT EXISTS cookbook_cover_candidates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS cookbook_cover_candidates_user_id_idx
  ON cookbook_cover_candidates (user_id);
CREATE INDEX IF NOT EXISTS cookbook_cover_candidates_expires_idx
  ON cookbook_cover_candidates (expires_at);

CREATE TABLE IF NOT EXISTS cookbook_cover_generation_log (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS cookbook_cover_generation_log_user_created_idx
  ON cookbook_cover_generation_log (user_id, created_at);

COMMIT;
