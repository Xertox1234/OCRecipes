-- recipe_finder_claims: paid recipe-finder claims (a finder Generate, a
-- Spoonacular list search) move off chat_messages.metadata into their own
-- append-only table (pre-flip item 4, todos/…recipe-finder-pre-flip-review-followups.md).
--
-- Why: a claim was a metadata marker on the user's chat row, so deleting that
-- message (DELETE /api/chat/messages/:id) or its whole conversation (the
-- chat_messages FK cascades) erased the claim and handed the paid slot back.
-- This table has NO conversation FK; message_id only records which row the
-- claim was taken on and goes NULL when that row is deleted.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. Not
-- order-independent: the new server bundle reads this table in
-- countRecipeGenerationsToday, which the legacy recipe/remix daily limit runs
-- on EVERY recipe and remix message, with RECIPE_FINDER_ENABLED off too. If
-- the table is missing when the deploy goes live, recipe chat returns 500.
-- The old running bundle never touches this table, so applying early is safe.
--
-- No backfill. RECIPE_FINDER_ENABLED has been off in production since the
-- finder shipped (#1151), so no old-style markers should exist. Measure it
-- before applying — if this is not 0, those claims stop counting for the rest
-- of today's UTC day after the deploy (tell the PR author before merging):
--   SELECT count(*) FROM chat_messages
--   WHERE metadata->>'recipeGeneration' = 'true'
--      OR metadata->>'spoonacularSearch' = 'true';
--
-- Names match what `db:push` creates from shared/schema.ts (recipeFinderClaims),
-- so a later push sees no diff. Idempotent (IF NOT EXISTS); the table is new
-- and empty, so the FK to chat_messages and both indexes build instantly.
--
-- Apply with:  psql "$DATABASE_URL" -1 -f migrations/0013_recipe_finder_claims.sql
-- Verify:      psql "$DATABASE_URL" -c '\d recipe_finder_claims'
--              (expect 5 columns, both indexes, both FKs)

CREATE TABLE IF NOT EXISTS recipe_finder_claims (
  id          serial PRIMARY KEY,
  user_id     varchar NOT NULL,
  kind        text NOT NULL,
  message_id  integer,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recipe_finder_claims_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT recipe_finder_claims_message_id_chat_messages_id_fk
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS recipe_finder_claims_user_kind_created_idx
  ON recipe_finder_claims (user_id, kind, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS recipe_finder_claims_message_kind_idx
  ON recipe_finder_claims (message_id, kind);
