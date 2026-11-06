-- Non-negative CHECKs on the numeric columns that had none (2026-11-05,
-- data-integrity audit finding L9 — the remainder of 2026-10-29 L-data-9):
-- meal_plan_recipes fiber/sugar/sodium per serving, and the quantity of
-- recipe_ingredients, pantry_items and grocery_list_items. Zod at the route
-- boundary was the only guard; the macro columns already carry `>= 0` CHECKs.
-- NULL still passes (the columns are nullable).
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the
-- schema now declares the constraints. ADD CONSTRAINT validates existing rows
-- and FAILS if any is already negative, so run the pre-check below first; it
-- must print 0 (if not, fix or null those rows before applying). Idempotent.
--
-- Pre-check (expect 0):
--   psql "$DATABASE_URL" -c "SELECT (SELECT count(*) FROM meal_plan_recipes WHERE fiber_per_serving < 0 OR sugar_per_serving < 0 OR sodium_per_serving < 0) + (SELECT count(*) FROM recipe_ingredients WHERE quantity < 0) + (SELECT count(*) FROM pantry_items WHERE quantity < 0) + (SELECT count(*) FROM grocery_list_items WHERE quantity < 0) AS negatives;"
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0039_nutrition_quantity_gte0.sql
--
-- Verify (paste the output; expect 6 rows):
--   psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conname IN ('mpr_fiber_gte0','mpr_sugar_gte0','mpr_sodium_gte0','recipe_ingredients_quantity_gte0','pantry_items_quantity_gte0','grocery_list_items_quantity_gte0') ORDER BY conname;"

BEGIN;

ALTER TABLE meal_plan_recipes DROP CONSTRAINT IF EXISTS mpr_fiber_gte0;
ALTER TABLE meal_plan_recipes ADD CONSTRAINT mpr_fiber_gte0 CHECK (fiber_per_serving >= 0);
ALTER TABLE meal_plan_recipes DROP CONSTRAINT IF EXISTS mpr_sugar_gte0;
ALTER TABLE meal_plan_recipes ADD CONSTRAINT mpr_sugar_gte0 CHECK (sugar_per_serving >= 0);
ALTER TABLE meal_plan_recipes DROP CONSTRAINT IF EXISTS mpr_sodium_gte0;
ALTER TABLE meal_plan_recipes ADD CONSTRAINT mpr_sodium_gte0 CHECK (sodium_per_serving >= 0);

ALTER TABLE recipe_ingredients DROP CONSTRAINT IF EXISTS recipe_ingredients_quantity_gte0;
ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_quantity_gte0 CHECK (quantity >= 0);
ALTER TABLE pantry_items DROP CONSTRAINT IF EXISTS pantry_items_quantity_gte0;
ALTER TABLE pantry_items ADD CONSTRAINT pantry_items_quantity_gte0 CHECK (quantity >= 0);
ALTER TABLE grocery_list_items DROP CONSTRAINT IF EXISTS grocery_list_items_quantity_gte0;
ALTER TABLE grocery_list_items ADD CONSTRAINT grocery_list_items_quantity_gte0 CHECK (quantity >= 0);

COMMIT;
