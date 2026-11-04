-- Recipe nutrition snapshot on daily logs (2026-10-31). A recipe log stored
-- only `recipe_id` + `servings`, and `getDailySummary` read the recipe's
-- nutrition at read time — so editing a recipe silently rewrote every past
-- day it was logged. `createDailyLog` now copies the recipe's per-serving
-- calories/protein/carbs/fat onto the row (UNSCALED; readers multiply by
-- `servings`), and the summary reads the copy before the live recipe.
-- Nullable with NO default: null = not snapshotted (scan logs, or recipe logs
-- written before this). Scan logs stay null — `scanned_items` already holds
-- each scan's own numbers.
--
-- The backfill copies today's recipe values: edits made BEFORE this migration
-- already rewrote those days and cannot be recovered; this only stops further
-- drift. A missing recipe value is copied as 0 (matching `createDailyLog`).
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle selects the whole daily_logs row, so every log read fails until the
-- columns exist. Recipe logs the OLD server writes between apply and deploy
-- are left un-snapshotted (the summary falls back to the live recipe for
-- them); re-running this file after the deploy fills them. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0033_daily_logs_recipe_nutrition_snapshot.sql
--
-- Verify (paste the output; expect 4 rows, then unfilled = 0 out of
-- recipe_logs):
--   psql "$DATABASE_URL" -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'daily_logs' AND column_name IN ('calories','protein','carbs','fat') ORDER BY column_name;"
--   psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE recipe_id IS NOT NULL AND calories IS NULL) AS unfilled, count(*) FILTER (WHERE recipe_id IS NOT NULL) AS recipe_logs FROM daily_logs;"

BEGIN;

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS calories numeric(10, 2),
  ADD COLUMN IF NOT EXISTS protein numeric(10, 2),
  ADD COLUMN IF NOT EXISTS carbs numeric(10, 2),
  ADD COLUMN IF NOT EXISTS fat numeric(10, 2);

ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_calories_gte0;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_calories_gte0 CHECK (calories >= 0);
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_protein_gte0;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_protein_gte0 CHECK (protein >= 0);
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_carbs_gte0;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_carbs_gte0 CHECK (carbs >= 0);
ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_fat_gte0;
ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_fat_gte0 CHECK (fat >= 0);

UPDATE daily_logs dl
SET calories = COALESCE(r.calories_per_serving, 0),
    protein = COALESCE(r.protein_per_serving, 0),
    carbs = COALESCE(r.carbs_per_serving, 0),
    fat = COALESCE(r.fat_per_serving, 0)
FROM meal_plan_recipes r
WHERE dl.recipe_id = r.id
  AND dl.calories IS NULL;

COMMIT;
