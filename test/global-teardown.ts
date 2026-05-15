/**
 * Vitest global setup/teardown: cleans up any test data that leaked past
 * transaction rollback into the real database.
 *
 * The teardown function runs once after ALL test files complete. Acts as a
 * safety net — if transaction-based isolation works correctly, this deletes
 * 0 rows.
 *
 * Naming convention (L-4, audit 2026-04-17):
 *   - `test-*` → Vitest test factories / insert helpers. Every new test
 *     that inserts into `community_recipes` MUST set
 *     `normalized_product_name` starting with `test-` so this teardown
 *     catches the row automatically.
 *   - `LEGACY_TEST_PRODUCT_NAMES` is a back-compat allowlist for dev DBs
 *     that still contain pre-convention leaks. Safe to drop after a few
 *     releases.
 *   - `testuser_*` → users inserted by `createTestUser()` in
 *     `test/db-test-utils.ts`. CASCADE deletes also clear their
 *     `verification_history` rows.
 *   - `99*` barcodes → verification fixtures created by
 *     `verification.test.ts`'s `makeBarcode()`. Only deleted when no
 *     user-owned table (`scanned_items`, `community_recipes`) references
 *     the barcode — protects against accidentally deleting real UPCs that
 *     happen to start with 99.
 */
import "dotenv/config";
import pg from "pg";

const LEGACY_TEST_PRODUCT_NAMES = [
  "test product",
  "test food",
  "original pasta",
];

export default function setup() {
  // Return the teardown function — Vitest calls it after all tests complete
  return async function teardown() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });

    try {
      // Prefix match catches every new test fixture; ANY($1) sweeps up the
      // legacy names that pre-date the convention.
      const recipes = await pool.query(
        `DELETE FROM community_recipes
         WHERE normalized_product_name ILIKE 'test-%'
            OR normalized_product_name = ANY($1)
         RETURNING id`,
        [LEGACY_TEST_PRODUCT_NAMES],
      );

      if (recipes.rowCount && recipes.rowCount > 0) {
        console.log(
          `[global-teardown] Cleaned up ${recipes.rowCount} leaked test recipe(s)`,
        );
      }

      // testuser_* sweep. users.id has ON DELETE CASCADE on
      // verification_history.userId, user_profiles.userId, and similar
      // user-owned tables, so a single DELETE clears all dependents.
      const users = await pool.query(
        `DELETE FROM users
         WHERE username LIKE 'testuser_%'
         RETURNING id`,
      );

      if (users.rowCount && users.rowCount > 0) {
        console.log(
          `[global-teardown] Cleaned up ${users.rowCount} leaked testuser_* row(s)`,
        );
      }

      // 99* barcode_verifications sweep — only orphans (no user-owned
      // reference). Runs AFTER the testuser_* cascade above, so any rows
      // remaining in verification_history or reformulation_flags for a
      // 99* barcode imply real-user activity and must be preserved.
      // verification_history.barcode and reformulation_flags.barcode
      // CASCADE from barcode_verifications.barcode, so a single DELETE
      // clears any truly-orphan dependents.
      const verifications = await pool.query(
        `DELETE FROM barcode_verifications bv
         WHERE bv.barcode LIKE '99%'
           AND NOT EXISTS (SELECT 1 FROM scanned_items si WHERE si.barcode = bv.barcode)
           AND NOT EXISTS (SELECT 1 FROM community_recipes cr WHERE cr.barcode = bv.barcode)
           AND NOT EXISTS (SELECT 1 FROM verification_history vh WHERE vh.barcode = bv.barcode)
           AND NOT EXISTS (SELECT 1 FROM reformulation_flags rf WHERE rf.barcode = bv.barcode)
         RETURNING barcode`,
      );

      if (verifications.rowCount && verifications.rowCount > 0) {
        console.log(
          `[global-teardown] Cleaned up ${verifications.rowCount} leaked 99* barcode_verifications row(s)`,
        );
      }

      // barcode_nutrition.barcode has no FK to barcode_verifications and no
      // user-owned reference column, so the orphan check uses the same
      // user-owned tables. No CASCADE dependents on this table.
      const nutrition = await pool.query(
        `DELETE FROM barcode_nutrition bn
         WHERE bn.barcode LIKE '99%'
           AND NOT EXISTS (SELECT 1 FROM scanned_items si WHERE si.barcode = bn.barcode)
           AND NOT EXISTS (SELECT 1 FROM community_recipes cr WHERE cr.barcode = bn.barcode)
         RETURNING barcode`,
      );

      if (nutrition.rowCount && nutrition.rowCount > 0) {
        console.log(
          `[global-teardown] Cleaned up ${nutrition.rowCount} leaked 99* barcode_nutrition row(s)`,
        );
      }
    } finally {
      await pool.end();
    }
  };
}
