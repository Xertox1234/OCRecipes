-- Store revocation time on `transactions` (2026-10-30, PR #1623 review). A
-- refunded/revoked row refuses any receipt purchased at or before the STORE's
-- revocation time (Apple `revocationDate`, falling back to the notification's
-- `signedDate`), not our processing time — a late-delivered notification must
-- not refuse a purchase made before we processed it. Nullable with NO default:
-- `null` means the row is not revoked; legacy revoked rows with `null` fall
-- back to `updated_at` (the previous rule).
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- bundle selects this column on every transactions read, so subscription
-- claims and store webhooks fail until it exists. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/0032_transactions_revoked_at.sql
--
-- Verify (paste the output; expect 1 row):
--   psql "$DATABASE_URL" -c "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'revoked_at';"

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMIT;
