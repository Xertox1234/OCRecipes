-- Replace the "at least one source" check on meal_plan_items with a strict XOR:
-- exactly one of recipe_id / scanned_item_id must be non-null.
--
-- API-level XOR validation already rejects two-source writes (see the archived
-- todo 2026-05-16-meal-plan-source-xor.md); this adds the DB-level guarantee so
-- direct writes and legacy data cannot violate the invariant.
--
-- PREREQUISITE: no meal_plan_items row has both recipe_id and scanned_item_id
-- set. The DO block below aborts the transaction if any such row exists — run
-- the backfill reconciliation first if it fires (null the scanned_item_id on
-- two-source rows; recipe_id is the canonical source).
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0005_meal_plan_items_source_xor.sql

BEGIN;

-- Fail loudly if any violating row still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM meal_plan_items
    WHERE recipe_id IS NOT NULL AND scanned_item_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'meal_plan_items still has two-source rows — run the backfill reconciliation first';
  END IF;
END $$;

ALTER TABLE meal_plan_items DROP CONSTRAINT IF EXISTS meal_plan_items_has_source;

ALTER TABLE meal_plan_items
  ADD CONSTRAINT meal_plan_items_source_xor
  CHECK (num_nonnulls(recipe_id, scanned_item_id) = 1);

COMMIT;
