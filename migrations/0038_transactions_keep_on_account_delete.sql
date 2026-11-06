-- Keep the store-purchase ledger when an account is deleted (2026-11-06,
-- audit 2026-10-29 L-data-8, owner ruling 2026-11-06). Deleting a user used to
-- CASCADE its `transactions` rows, so a refunded purchase's record vanished and
-- its pre-refund receipt (a static snapshot with no revocationDate) could be
-- replayed on a new account for Premium. The row now outlives the account with
-- `user_id` NULL (deleteUser also blanks its `receipt`), keeping only the store
-- transaction id and its refund state. One new account may take an ownerless
-- row over unless it was refunded after the receipt's purchase.
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES, then
-- run the post-deploy cleanup below once the new code is live. Idempotent.
-- In the window between applying this and deploying the new code, the OLD
-- server runs on the new schema:
--  - an account deleted in the window keeps an ownerless row WITH its receipt
--    (the old deleteUser does not blank it) — the cleanup below blanks it;
--  - an old renewal webhook for an ownerless row throws ("User null not
--    found") → 5xx → the store retries, and the new code answers it;
--  - an ownerless-row refund calls the tier cache with a null user (no-op).
-- Claims are safe: the old code treats an ownerless row as `conflict`.
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0038_transactions_keep_on_account_delete.sql
--
-- Verify (paste the output; expect "YES|n"):
--   psql "$DATABASE_URL" -Atc "SELECT c.is_nullable || '|' || k.confdeltype::text FROM information_schema.columns c, pg_constraint k WHERE c.table_name = 'transactions' AND c.column_name = 'user_id' AND k.conname = 'transactions_user_id_users_id_fk';"
--
-- Post-deploy cleanup (once the new code is live; idempotent, expect "UPDATE 0"
-- unless an account was deleted in the window):
--   psql "$DATABASE_URL" -c "UPDATE transactions SET receipt = '' WHERE user_id IS NULL AND receipt <> '';"

BEGIN;

ALTER TABLE transactions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_user_id_users_id_fk;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
