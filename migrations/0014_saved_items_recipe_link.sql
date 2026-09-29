-- saved_items.recipe_id / recipe_type: a Saved Items row can point at a real
-- recipe the user saved (user ruling 2026-09-29: every recipe Save also lands
-- in Profile > Saved Items; Favourites stays separate).
--
-- Why: the Spoonacular "Save" writes meal_plan_recipes and the chat "Save"
-- writes a private community_recipes row, but no Profile screen lists either,
-- so a saved recipe looked lost. The save routes now also insert a linked
-- saved_items row, and tapping it opens the recipe.
--
-- Both columns are nullable: existing rows are snapshot items (suggestions)
-- and keep working unchanged. Polymorphic like favourite_recipes, so no FK —
-- the community and meal-plan recipe delete paths remove the linked row.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle writes these columns on every catalog and chat save, and the saved
-- items routes select them; without the columns those routes return 500. The
-- old running bundle never touches them (it selects named columns via
-- Drizzle), so applying early is safe.
--
-- No backfill: recipes saved before this ship get their Saved Items row the
-- next time the user taps Save on them (both save routes are idempotent and
-- re-link on the already-saved path). A bulk backfill would push free users
-- past their saved-items cap.
--
-- Column, index and constraint names match what `drizzle-kit generate` emits
-- for shared/schema.ts (savedItems). Idempotent (IF NOT EXISTS / DO block):
-- re-running it skips every step. Adding
-- nullable columns with no default is a metadata-only change; the unique
-- index is partial (recipe_id IS NOT NULL) and covers zero rows at apply time.
--
-- Apply with:  psql "$DATABASE_URL" -1 -f migrations/0014_saved_items_recipe_link.sql

ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS recipe_id integer;
ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS recipe_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_items_recipe_link_both_or_neither'
  ) THEN
    ALTER TABLE saved_items
      ADD CONSTRAINT saved_items_recipe_link_both_or_neither
      CHECK ((recipe_id IS NULL) = (recipe_type IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS saved_items_user_recipe_unique
  ON saved_items (user_id, recipe_type, recipe_id)
  WHERE recipe_id IS NOT NULL;
