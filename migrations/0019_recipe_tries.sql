-- "I tried it" on public community recipes + indexes for its counts.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads recipe_tries on every recipe stats request, so the table must
-- exist before that bundle deploys. Applying early is safe for the old bundle:
-- a new table it never reads and two indexes. Additive and idempotent; no
-- backfill. Constraint and index names match Drizzle's.

CREATE TABLE IF NOT EXISTS recipe_tries (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT recipe_tries_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  recipe_id integer NOT NULL
    CONSTRAINT recipe_tries_recipe_id_community_recipes_id_fk REFERENCES community_recipes(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT recipe_tries_user_recipe_uniq UNIQUE (user_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS recipe_tries_recipe_created_idx
  ON recipe_tries (recipe_id, created_at);

CREATE INDEX IF NOT EXISTS favourite_recipes_recipe_idx
  ON favourite_recipes (recipe_id, recipe_type);
CREATE INDEX IF NOT EXISTS community_recipes_remixed_from_idx
  ON community_recipes (remixed_from_id);
