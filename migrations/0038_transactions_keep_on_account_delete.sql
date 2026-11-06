-- Keep the store-purchase ledger when an account is deleted (2026-11-06,
-- audit 2026-10-29 L-data-8, owner ruling 2026-11-06). Deleting a user used to
-- CASCADE its `transactions` rows, so a refunded purchase's record vanished and
-- its pre-refund receipt (a static snapshot with no revocationDate) could be
-- replayed on a new account for Premium. The row now outlives the account with
-- `user_id` NULL (deleteUser also blanks its `receipt`), keeping only the store
-- transaction id and its refund state. One new account may take an ownerless
-- row over unless it was refunded after the receipt's purchase.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the new
-- deleteUser writes `receipt = ''` and relies on the FK no longer cascading;
-- the old code is safe on the new schema except that an orphan-row refund
-- would call the tier cache with a null user. Idempotent.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0038_transactions_keep_on_account_delete.sql
--
-- Verify (paste the output; expect "YES|n"):
--   psql "$DATABASE_URL" -Atc "SELECT c.is_nullable || '|' || k.confdeltype::text FROM information_schema.columns c, pg_constraint k WHERE c.table_name = 'transactions' AND c.column_name = 'user_id' AND k.conname = 'transactions_user_id_users_id_fk';"

BEGIN;

ALTER TABLE transactions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_user_id_users_id_fk;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
