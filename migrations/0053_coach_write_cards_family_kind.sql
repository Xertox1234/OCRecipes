-- Coach family card (Coach roadmap A3; owner ruling 2026-11-27): one more
-- write-card kind, 'family', which adds one family member the user named in
-- the chat. Only the kind check widens. No table, column or data change: what
-- Undo needs lives in the existing saved_refs JSON.
--
-- ORDERING — APPLY TO PROD BEFORE THE OTA THAT DECLARES THE 'family' CARD
-- KIND SHIPS (and after 0052). Safe to run twice, and harmless to the old
-- server, which never writes the kind. (Follows 0052, the reminders card.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0053_coach_write_cards_family_kind.sql
--
-- Verify (paste the output; expect a line that names 'reminders' and 'family').
-- to_regclass cannot see a constraint, so read its definition:
--   psql "$DATABASE_URL" -Atc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'coach_write_cards_kind_check'"

BEGIN;

ALTER TABLE coach_write_cards
  DROP CONSTRAINT IF EXISTS coach_write_cards_kind_check;

ALTER TABLE coach_write_cards
  ADD CONSTRAINT coach_write_cards_kind_check
  CHECK (kind IN ('food', 'grocery', 'plan', 'pantry', 'goals', 'allergy', 'reminders', 'family'));

COMMIT;
