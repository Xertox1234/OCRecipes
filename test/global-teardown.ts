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
      // Prefix match catches every new test fixture; ANY($2) sweeps up the
      // legacy names that pre-date the convention.
      const result = await pool.query(
        `DELETE FROM community_recipes
         WHERE normalized_product_name ILIKE 'test-%'
            OR normalized_product_name = ANY($1)
         RETURNING id`,
        [LEGACY_TEST_PRODUCT_NAMES],
      );

      if (result.rowCount && result.rowCount > 0) {
        console.log(
          `[global-teardown] Cleaned up ${result.rowCount} leaked test recipe(s)`,
        );
      }
    } finally {
      await pool.end();
    }
  };
}
