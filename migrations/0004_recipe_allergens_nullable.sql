-- Make the `allergens` jsonb cache nullable on community + meal-plan recipes.
--
-- `0003_recipe_allergens.sql` added the column as `NOT NULL DEFAULT '[]'`. An
-- empty list cannot distinguish "analyzed, genuinely no allergens" from "not
-- yet derived" — so every pre-backfill row read as `[]` and was treated as
-- allergen-free by the "Safe for me" filter (fail-open).
--
-- After this migration `null` means "not derived" and is conservatively
-- excluded by `isRecipeSafeForAllergies` (fail-closed); `[]` keeps its meaning
-- "derived, genuinely no allergens" = safe. Write paths always store a
-- concrete array, so `null` only ever appears for rows awaiting the backfill.
--
-- The UPDATE resets existing `[]` rows (written by the 0003 default) back to
-- `null` so they are no longer falsely treated as safe. The backfill script
-- (server/scripts/backfill-recipe-allergens.ts) rewrites genuinely-empty
-- allergen profiles back to `[]`.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0004_recipe_allergens_nullable.sql
-- Safe to re-run: DROP NOT NULL / DROP DEFAULT are idempotent; the UPDATE is
-- a no-op once the backfill has populated concrete arrays.

BEGIN;

ALTER TABLE community_recipes ALTER COLUMN allergens DROP NOT NULL;
ALTER TABLE community_recipes ALTER COLUMN allergens DROP DEFAULT;

ALTER TABLE meal_plan_recipes ALTER COLUMN allergens DROP NOT NULL;
ALTER TABLE meal_plan_recipes ALTER COLUMN allergens DROP DEFAULT;

UPDATE community_recipes  SET allergens = NULL WHERE allergens = '[]'::jsonb;
UPDATE meal_plan_recipes  SET allergens = NULL WHERE allergens = '[]'::jsonb;

COMMIT;
