-- Durable per-account cap on password guesses through /api/auth/social/link
-- (auth audit 2026-10-10 L15). Replaces an in-memory limiter that every
-- deploy reset.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads and writes social_link_guesses on every password link attempt,
-- so the table must exist before that bundle deploys. Applying early is safe
-- for the old bundle: a new table it never reads. Additive and idempotent; no
-- backfill. Constraint names match Drizzle's.

CREATE TABLE IF NOT EXISTS social_link_guesses (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT social_link_guesses_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  count integer DEFAULT 0 NOT NULL,
  window_start timestamp with time zone NOT NULL
);
