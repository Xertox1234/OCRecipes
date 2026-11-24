-- Coach goals and allergy cards (Coach roadmap T1): two more write-card kinds,
-- 'goals' and 'allergy'. Only the kind check widens. No table, column or data
-- change: what Undo needs lives in the existing saved_refs JSON. 'allergy' is
-- allowed ahead of its card so production is altered once for both.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Safe to
-- run twice, and harmless to the old server, which never writes either kind.
-- (Follows 0049, the dish images.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0050_coach_write_cards_goals_allergy_kinds.sql
--
-- Verify (paste the output; expect a line that names 'goals' and 'allergy').
-- to_regclass cannot see a constraint, so read its definition:
--   psql "$DATABASE_URL" -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coach_write_cards_kind_check'"

BEGIN;

ALTER TABLE coach_write_cards
  DROP CONSTRAINT IF EXISTS coach_write_cards_kind_check;

ALTER TABLE coach_write_cards
  ADD CONSTRAINT coach_write_cards_kind_check
  CHECK (kind IN ('food', 'grocery', 'plan', 'pantry', 'goals', 'allergy'));

COMMIT;
