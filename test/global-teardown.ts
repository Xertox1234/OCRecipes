/**
 * Vitest global setup/teardown: cleans up any test data that leaked past
 * transaction rollback into the real database.
 *
 * The teardown function runs once after ALL test files complete. Acts as a
 * safety net — if transaction-based isolation works correctly, this deletes
 * 0 rows.
 */
import "dotenv/config";
import pg from "pg";

const TEST_PRODUCT_NAMES = ["test product", "test food", "original pasta"];

export default function setup() {
  // Return the teardown function — Vitest calls it after all tests complete
  return async function teardown() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return;

    const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });

    try {
      const result = await pool.query(
        `DELETE FROM community_recipes
         WHERE normalized_product_name = ANY($1)
         RETURNING id`,
        [TEST_PRODUCT_NAMES],
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
