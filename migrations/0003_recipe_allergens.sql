-- Add denormalized `allergens` jsonb cache to community + meal-plan recipes.
--
-- Pairs with the "Safe for me" allergen filter on recipe search. The column
-- caches the output of `deriveRecipeAllergens` (shared/constants/allergens.ts)
-- so the search predicate does not re-derive allergens per request. New/edited
-- recipes recompute it on the storage write paths; existing rows are populated
-- by `server/scripts/backfill-recipe-allergens.ts`.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0003_recipe_allergens.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent.

BEGIN;

ALTER TABLE community_recipes
  ADD COLUMN IF NOT EXISTS allergens jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS allergens jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
