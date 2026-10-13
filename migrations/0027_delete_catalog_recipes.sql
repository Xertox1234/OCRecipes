-- Remove meal-plan recipes saved word-for-word from Spoonacular
-- (inspired-recipes spec 2026-10-12 §6; owner ruling 2026-10-12: existing
-- recipe data may be deleted freely).
--
-- ORDERING — APPLY AFTER THE PR THAT REMOVES THE CATALOG SAVE ROUTE HAS
-- DEPLOYED (otherwise a save could recreate rows). Idempotent.
--
-- Every reference to meal_plan_recipes(id), checked against shared/schema.ts:
--   FK, ON DELETE CASCADE (handled by the final DELETE):
--     recipe_ingredients.recipe_id, meal_plan_items.recipe_id,
--     daily_logs.recipe_id
--   No FK (polymorphic recipe_id + recipe_type = 'mealPlan'), deleted
--   explicitly first: saved_items, favourite_recipes, cookbook_recipes.
--   (community-recipe tables reference community_recipes, not this table.)

BEGIN;
DELETE FROM saved_items
  WHERE recipe_type = 'mealPlan'
    AND recipe_id IN (SELECT id FROM meal_plan_recipes WHERE source_type = 'catalog');
DELETE FROM favourite_recipes
  WHERE recipe_type = 'mealPlan'
    AND recipe_id IN (SELECT id FROM meal_plan_recipes WHERE source_type = 'catalog');
DELETE FROM cookbook_recipes
  WHERE recipe_type = 'mealPlan'
    AND recipe_id IN (SELECT id FROM meal_plan_recipes WHERE source_type = 'catalog');
DELETE FROM meal_plan_recipes WHERE source_type = 'catalog';
COMMIT;
