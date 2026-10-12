-- Drop the short-password upgrade pass (owner ruling 2026-10-12: no forced
-- "longer password or two-step" stop at sign-in, so nothing mints a pass).
--
-- ORDERING — APPLY AFTER THE PR THAT SHIPS THIS FILE HAS MERGED AND DEPLOYED.
-- This is the reverse of an additive migration: the old server bundle still
-- queries this table (its /api/auth/upgrade/* routes and the retention
-- sweep), so the table must outlive that bundle. The new bundle never touches
-- it. Idempotent; the table's indexes and foreign key go with it.

DROP TABLE IF EXISTS password_upgrade_passes;
