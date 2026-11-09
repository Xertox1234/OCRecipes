-- Coach write cards (spec docs/superpowers/specs/2026-11-09-coach-write-cards-design.md).
-- A card Coach shows in the chat for the user to check and save (food log,
-- grocery items, meal plan days). At most one LIVE card per conversation.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and idempotent; the old server never reads the table.
-- (0041 is taken by the open perf-audit PR #1811.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0042_coach_write_cards.sql
--
-- Verify (paste the output; expect "true|1"):
--   psql "$DATABASE_URL" -Atc "SELECT (to_regclass('public.coach_write_cards') IS NOT NULL) || '|' || (SELECT count(*) FROM pg_indexes WHERE indexname = 'coach_write_cards_one_live');"

BEGIN;

CREATE TABLE IF NOT EXISTS coach_write_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id integer NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  edits jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'live',
  saved_refs jsonb,
  saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT coach_write_cards_kind_check CHECK (kind IN ('food', 'grocery', 'plan')),
  CONSTRAINT coach_write_cards_status_check CHECK (status IN ('live', 'saved', 'replaced', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_write_cards_one_live
  ON coach_write_cards (conversation_id) WHERE status = 'live';

CREATE INDEX IF NOT EXISTS coach_write_cards_conv_created_idx
  ON coach_write_cards (conversation_id, created_at);

COMMIT;
