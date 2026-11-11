-- AI-sharing permission: record that a user allowed their data to go to the AI
-- companies the app names (privacy audit 2026-11-10, finding H3; owner ruling
-- 2026-11-10 — ask first, and make no AI call on "Not now").
--
--   ai_sharing_allowed_at  set while the permission is on record; NULL = not
--                          allowed, and the server makes no AI call for the user
--   ai_sharing_version     the disclosure version the permission was given against
--   ai_sharing_history     append-only log of every answer ({event, at, version});
--                          empty = the user has never been asked
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent (two nullable columns and one defaulted jsonb column,
-- no backfill); the old server never reads them. (Follows 0043, the health
-- consent version and withdrawal.)
--
-- AFTER THE DEPLOY every existing account starts with AI features off until it
-- answers the question in the app (the app asks on next open).
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0044_ai_sharing_permission.sql
--
-- Verify (paste the output; expect "3"):
--   psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('ai_sharing_allowed_at', 'ai_sharing_version', 'ai_sharing_history');"

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_sharing_allowed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_sharing_version text,
  ADD COLUMN IF NOT EXISTS ai_sharing_history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
