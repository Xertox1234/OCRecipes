-- Shared dish pictures (spec 2026-11-19): one generated picture per dish name,
-- reused by every later quick entry of the same name, by anyone. name_hash is a
-- SHA-256 of the normalised dish name (server/lib/dish-image-key.ts), so typed
-- text is never stored here. No user column: a row keeps the stored image alive
-- after the entry or account that first made it is deleted.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES. Purely
-- additive and safe to run twice; the old server never reads the new table.
-- The new server queries it on every quick-entry create and every recipe-image
-- cleanup, so it must exist first.
-- (Follows 0048, the coach pantry card kind.)
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0049_dish_images.sql
--
-- Verify (paste the output; expect dish_images):
--   psql "$DATABASE_URL" -Atc "SELECT to_regclass('public.dish_images')"

BEGIN;

CREATE TABLE IF NOT EXISTS dish_images (
  name_hash text PRIMARY KEY,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
