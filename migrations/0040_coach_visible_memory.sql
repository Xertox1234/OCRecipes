-- Coach visible memory (spec docs/superpowers/specs/2026-11-08-coach-visible-memory-design.md).
-- coach_notebook: confirmed_at / label / shown_at, and a 'rejected' status so an
-- undone fact is never re-saved. user_profiles: a decaying mood score.
-- Existing active goals and preferences start confirmed (owner decision
-- 2026-11-08) and already shown, so no popup fires for old memories.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Additive
-- and idempotent; the old server ignores the new columns and never writes
-- 'rejected'.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0040_coach_visible_memory.sql
--
-- Verify (paste the output; expect "3|2"):
--   psql "$DATABASE_URL" -Atc "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name='coach_notebook' AND column_name IN ('confirmed_at','label','shown_at')) || '|' || (SELECT count(*) FROM information_schema.columns WHERE table_name='user_profiles' AND column_name IN ('mood_score','mood_updated_at'));"

BEGIN;

ALTER TABLE coach_notebook ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE coach_notebook ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE coach_notebook ADD COLUMN IF NOT EXISTS shown_at timestamptz;

ALTER TABLE coach_notebook DROP CONSTRAINT IF EXISTS coach_notebook_status_check;
ALTER TABLE coach_notebook ADD CONSTRAINT coach_notebook_status_check
  CHECK (status IN ('active', 'completed', 'expired', 'archived', 'rejected'));

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mood_score real NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS mood_updated_at timestamptz;

UPDATE coach_notebook
   SET confirmed_at = now(), shown_at = now()
 WHERE status = 'active'
   AND type IN ('goal', 'preference')
   AND confirmed_at IS NULL;

COMMIT;
