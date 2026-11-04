-- Paid-AI-call daily caps (2026-10-31, todo P2-2026-10-29-ai-cost-caps-before-paid-calls).
-- `recipe_generation_log` becomes the per-user daily log for every capped paid
-- AI call: a `kind` column says which quota a row counts against. Existing rows
-- are recipe generations, so the default 'recipe' backfills them exactly.
-- Recipe-quota counts now filter kind = 'recipe'; new kinds (frontLabel,
-- menuScan, ...) never share that bucket. The cap values live in
-- AI_DAILY_CAPS (shared/types/premium.ts), not in the database.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- server filters and inserts on `kind`, so recipe quota reads fail until the
-- column exists. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0034_ai_call_log_kind.sql
--
-- Verify (paste the output; expect one row: kind | text | 'recipe'::text | NO):
--   psql "$DATABASE_URL" -c "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'recipe_generation_log' AND column_name = 'kind';"

BEGIN;

ALTER TABLE recipe_generation_log
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'recipe';

COMMIT;
