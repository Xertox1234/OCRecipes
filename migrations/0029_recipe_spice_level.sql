-- AI-set `spice_level` (mild / medium / hot) on community + meal-plan recipes
-- (recipe spice icon todo, 2026-10-17). Written when OUR AI writes a recipe
-- (recipe generation + recipe chat) and filled for old rows by
-- server/scripts/backfill-recipe-spice-level.ts. Nullable with NO default:
-- `null` means "not worked out" (imports, manual entry, no heat) and shows no
-- icon.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle selects this column on every recipe query, so recipe reads fail until
-- it exists. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0029_recipe_spice_level.sql
--
-- Verify (paste the output; expect 2 rows):
--   psql "$DATABASE_URL" -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE column_name = 'spice_level' AND table_name IN ('community_recipes','meal_plan_recipes') ORDER BY table_name;"

BEGIN;

ALTER TABLE community_recipes
  ADD COLUMN IF NOT EXISTS spice_level text;

ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS spice_level text;

COMMIT;
