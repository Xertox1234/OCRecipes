-- AI-written recipe ideas (inspired-recipes spec 2026-10-12).
--
-- ORDERING — APPLY BEFORE THE PR THAT SHIPS THIS FILE MERGES (additive: the
-- new bundle reads/writes this table on its first request). Idempotent.

CREATE TABLE IF NOT EXISTS inspired_suggestions (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  total_minutes integer NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url text,
  making_started_at timestamptz,
  made_recipe_id integer REFERENCES community_recipes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS inspired_suggestions_user_created_idx
  ON inspired_suggestions (user_id, created_at);
CREATE INDEX IF NOT EXISTS inspired_suggestions_expires_idx
  ON inspired_suggestions (expires_at);
