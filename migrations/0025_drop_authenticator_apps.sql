-- Remove authenticator apps and recovery codes (owner ruling 4, 2026-10-12:
-- two-step is an emailed code only).
--
-- ORDERING — APPLY AFTER THE PR THAT SHIPS THIS FILE HAS MERGED AND DEPLOYED.
-- The old server bundle still reads these columns and this table (the
-- authenticator check, recovery codes, user_mfa.method), so they must outlive
-- it. The new bundle never touches them. Idempotent.
--
-- Refuses to run while any account still has an authenticator: dropping its
-- secret would strand it. Turn that account's two-step off first.

-- Nested, not one `IF a AND b`: the row check names a column that is gone on
-- a re-run, and is only planned when the outer check lets it run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_mfa' AND column_name = 'totp_secret_enc'
  ) THEN
    IF EXISTS (SELECT 1 FROM user_mfa WHERE totp_secret_enc IS NOT NULL) THEN
      RAISE EXCEPTION 'An account still uses an authenticator app; turn its two-step off before dropping it';
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS mfa_recovery_codes;

ALTER TABLE user_mfa DROP CONSTRAINT IF EXISTS user_mfa_method_check;
ALTER TABLE user_mfa
  DROP COLUMN IF EXISTS method,
  DROP COLUMN IF EXISTS totp_secret_enc,
  DROP COLUMN IF EXISTS totp_last_step,
  DROP COLUMN IF EXISTS pending_secret_enc,
  DROP COLUMN IF EXISTS pending_expires_at;

