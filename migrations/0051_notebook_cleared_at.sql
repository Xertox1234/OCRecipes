-- "Clear everything Coach knows" stamps the profile (coach chat audit
-- 2026-11-24, L108). A note extraction started before the clear finishes after
-- it; without the stamp it wrote its notes and mood nudge back into the
-- notebook the user had just emptied. The server compares the stamp with the
-- turn's start and drops the late write.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Drizzle
-- names every column in a profile read, so a server that knows the column
-- fails every profile read until it exists. Additive and idempotent: existing
-- rows take NULL (never cleared), and the old server never reads the column.
-- (Follows 0050, the goals and allergy write cards.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0051_notebook_cleared_at.sql
--
-- Verify (paste the output; expect "notebook_cleared_at|timestamp with time zone|YES"):
--   psql "$DATABASE_URL" -Atc "SELECT column_name || '|' || data_type || '|' || is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'notebook_cleared_at';"

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS notebook_cleared_at timestamptz;

COMMIT;
