-- Coach pantry card (spec 2026-11-16): a fourth write-card kind, 'pantry'.
-- Only the kind check widens. No table, column or data change: the card's row
-- copies for Undo live in the existing saved_refs JSON.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Safe to
-- run twice, and harmless to the old server, which never writes 'pantry'.
-- (Follows 0047, the family profiles.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0048_coach_write_cards_pantry_kind.sql
--
-- Verify (paste the output; expect a line that names 'pantry'). to_regclass
-- cannot see a constraint, so read its definition:
--   psql "$DATABASE_URL" -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coach_write_cards_kind_check'"

BEGIN;

ALTER TABLE coach_write_cards
  DROP CONSTRAINT IF EXISTS coach_write_cards_kind_check;

ALTER TABLE coach_write_cards
  ADD CONSTRAINT coach_write_cards_kind_check
  CHECK (kind IN ('food', 'grocery', 'plan', 'pantry'));

COMMIT;
