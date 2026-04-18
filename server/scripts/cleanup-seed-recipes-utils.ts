/**
 * Pure helpers for `cleanup-seed-recipes.ts`.
 *
 * Extracted so we can unit-test the classification logic without booting a
 * real Postgres connection. See the sibling `__tests__/cleanup-seed-recipes-utils.test.ts`.
 *
 * Naming convention (L-4, audit 2026-04-17):
 *   - `seed-*` — written by `server/scripts/seed-recipes.ts`
 *   - `test-*` — written by Vitest test factories/helpers. Every new test
 *     that inserts into `communityRecipes` MUST set
 *     `normalizedProductName` starting with `test-` so cleanup catches it
 *     automatically, with no manual coordination required.
 *
 * The prefix filter subsumes the old `TEST_PRODUCT_NAMES` allowlist for new
 * leaks. `LEGACY_TEST_PRODUCT_NAMES` is kept as a one-off back-compat list
 * so long-lived dev databases still get scrubbed, and can be dropped after
 * a few release cycles.
 */

export const SEED_PREFIX = "seed-";
export const TEST_PREFIX = "test-";

/**
 * Legacy test recipe names that pre-date the `test-` prefix convention.
 * DO NOT add new entries — use the `test-` prefix in the test helper that
 * inserts the recipe instead. Kept for back-compat against dev databases
 * that still contain pre-convention leaks.
 *
 * Mutable `string[]` (not `readonly`) because Drizzle's `inArray` operator
 * requires a mutable array signature. Treat as append-only-via-PR in code
 * review — never mutate at runtime.
 */
export const LEGACY_TEST_PRODUCT_NAMES: string[] = [
  "test product",
  "test food",
  "original pasta",
];

/**
 * Returns true if `normalizedProductName` matches the seed/test cleanup
 * contract: either a known prefix, or one of the legacy allowlist names.
 *
 * Case-insensitive to mirror the SQL `ILIKE` used by the cleanup query.
 */
export function isJunkRecipeName(normalizedProductName: string): boolean {
  const lower = normalizedProductName.toLowerCase();
  if (lower.startsWith(SEED_PREFIX)) return true;
  if (lower.startsWith(TEST_PREFIX)) return true;
  if (LEGACY_TEST_PRODUCT_NAMES.includes(lower)) return true;
  return false;
}
