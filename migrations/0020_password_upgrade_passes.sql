-- Password policy part 2: the restricted pass a password under 15 earns at
-- sign-in on an account without two-step (spec 2026-10-10 password policy §6).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle writes password_upgrade_passes on every short-password sign-in, so the
-- table must exist before that bundle deploys. Applying early is safe for the
-- old bundle: a new table it never reads and two indexes. Additive and
-- idempotent; no backfill. Constraint and index names match Drizzle's.

CREATE TABLE IF NOT EXISTS password_upgrade_passes (
  id_hash text NOT NULL PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT password_upgrade_passes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  two_step_allowed boolean NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS password_upgrade_passes_user_id_idx
  ON password_upgrade_passes (user_id);
CREATE INDEX IF NOT EXISTS password_upgrade_passes_expires_at_idx
  ON password_upgrade_passes (expires_at);
