-- Derived `diet_conflicts` jsonb cache on community + meal-plan recipes
-- (recipe attribute icons spec 2026-10-17). Caches `deriveRecipeDietConflicts`
-- (shared/constants/diet-conflicts.ts). Nullable with NO default: `null` means
-- "not checked yet", and the diet icons stay hidden until the backfill
-- (server/scripts/backfill-recipe-allergens.ts) fills it.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle selects this column on every recipe query. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0028_recipe_diet_conflicts.sql

BEGIN;

ALTER TABLE community_recipes
  ADD COLUMN IF NOT EXISTS diet_conflicts jsonb;

ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS diet_conflicts jsonb;

COMMIT;
