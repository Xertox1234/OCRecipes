-- Non-negative CHECKs on scanned_items fiber / sugar / sodium (2026-11-01,
-- todo P3-2026-10-29-server-hygiene-leftovers, audit finding L-data-9).
-- calories/protein/carbs/fat already carry `>= 0` CHECKs; these three did not,
-- so a negative value from an OCR or label parse could be stored. NULL still
-- passes (the columns are nullable).
--
-- ORDERING — APPLY TO PROD BEFORE THE PR THAT SHIPS THIS FILE MERGES: the
-- schema now declares the constraints. ADD CONSTRAINT validates existing rows
-- and FAILS if any is already negative, so run the pre-check below first; it
-- must print 0 (if not, fix or null those rows before applying). Idempotent.
--
-- Pre-check (expect 0):
--   psql "$DATABASE_URL" -c "SELECT count(*) FROM scanned_items WHERE fiber < 0 OR sugar < 0 OR sodium < 0;"
--
-- Apply with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0036_scanned_items_micro_gte0.sql
--
-- Verify (paste the output; expect 3 rows):
--   psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE conrelid = 'scanned_items'::regclass AND conname IN ('scanned_items_fiber_gte0','scanned_items_sugar_gte0','scanned_items_sodium_gte0') ORDER BY conname;"

BEGIN;

ALTER TABLE scanned_items DROP CONSTRAINT IF EXISTS scanned_items_fiber_gte0;
ALTER TABLE scanned_items ADD CONSTRAINT scanned_items_fiber_gte0 CHECK (fiber >= 0);
ALTER TABLE scanned_items DROP CONSTRAINT IF EXISTS scanned_items_sugar_gte0;
ALTER TABLE scanned_items ADD CONSTRAINT scanned_items_sugar_gte0 CHECK (sugar >= 0);
ALTER TABLE scanned_items DROP CONSTRAINT IF EXISTS scanned_items_sodium_gte0;
ALTER TABLE scanned_items ADD CONSTRAINT scanned_items_sodium_gte0 CHECK (sodium >= 0);

COMMIT;
