-- Soft delete for personal recipes (2026-10-29). `daily_logs.recipe_id`
-- references `meal_plan_recipes.id` ON DELETE CASCADE, so deleting a recipe
-- used to delete every daily log that recorded eating it — the user's past
-- days silently lost those calories. Deleting a recipe now stamps
-- `deleted_at` instead; user-facing reads filter `deleted_at IS NULL`, and
-- nutrition-history reads keep joining the row. Nullable with NO default:
-- `null` means the recipe is live.
--
-- The (user_id, external_id) unique index becomes partial on live rows, so a
-- deleted catalog recipe never blocks saving the same recipe again. No app
-- path writes `external_id` with an ON CONFLICT target, so making it partial
-- breaks no upsert. No new index on `deleted_at`: every hot read filters it
-- together with `user_id` (served by meal_plan_recipes_user_id_idx) or `id`.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle selects and filters this column on every recipe query, so recipe
-- reads fail until it exists. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0031_meal_plan_recipes_soft_delete.sql
--
-- Verify (paste the output; expect 1 row for the column, and an index
-- definition that ends in `WHERE (deleted_at IS NULL)`):
--   psql "$DATABASE_URL" -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name = 'meal_plan_recipes' AND column_name = 'deleted_at';"
--   psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE indexname = 'meal_plan_recipes_user_external_id_idx';"

BEGIN;

ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP INDEX IF EXISTS meal_plan_recipes_user_external_id_idx;
CREATE UNIQUE INDEX meal_plan_recipes_user_external_id_idx
  ON meal_plan_recipes (user_id, external_id)
  WHERE deleted_at IS NULL;

COMMIT;
