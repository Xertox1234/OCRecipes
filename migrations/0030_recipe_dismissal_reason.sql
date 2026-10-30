-- Why someone hid a For You recipe (Home carousel dismiss sheet, 2026-10-29):
-- one of shared/constants/recipe-dismiss-reasons.ts, validated by the route's
-- zod enum. Nullable with NO default: `null` means the recipe was hidden by an
-- app version that never asked, or before this column existed.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle writes this column on every dismiss, and the account data export
-- selects every recipe_dismissals column, so both fail until it exists.
-- Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0030_recipe_dismissal_reason.sql
--
-- Verify (paste the output; expect 1 row):
--   psql "$DATABASE_URL" -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name = 'recipe_dismissals' AND column_name = 'reason';"

BEGIN;

ALTER TABLE recipe_dismissals
  ADD COLUMN IF NOT EXISTS reason text;

COMMIT;
