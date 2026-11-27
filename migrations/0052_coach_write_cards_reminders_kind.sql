-- Coach reminders card (Coach roadmap A3): one more write-card kind,
-- 'reminders', which switches the Coach Reminders types on and off from the
-- chat. Only the kind check widens. No table, column or data change: what
-- Undo needs lives in the existing saved_refs JSON.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Safe to
-- run twice, and harmless to the old server, which never writes the kind.
-- (Follows 0051, the notebook clear stamp.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0052_coach_write_cards_reminders_kind.sql
--
-- Verify (paste the output; expect a line that names 'reminders').
-- to_regclass cannot see a constraint, so read its definition:
--   psql "$DATABASE_URL" -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coach_write_cards_kind_check'"

BEGIN;

ALTER TABLE coach_write_cards
  DROP CONSTRAINT IF EXISTS coach_write_cards_kind_check;

ALTER TABLE coach_write_cards
  ADD CONSTRAINT coach_write_cards_kind_check
  CHECK (kind IN ('food', 'grocery', 'plan', 'pantry', 'goals', 'allergy', 'reminders'));

COMMIT;
