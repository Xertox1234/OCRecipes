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

import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { communityRecipes, users } from "@shared/schema";

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
 * The REAL deletion perimeter `cleanup-seed-recipes.ts` executes — moved here
 * verbatim so the test suite asserts on the SQL the script actually runs
 * (its predecessor, `isJunkRecipeName`, was a TypeScript reimplementation the
 * script never called; an unanchored ILIKE regression stayed green there).
 *
 * Scope: (orphan OR demo-authored) AND (seed-prefix OR test-prefix OR legacy
 * name). The author scope is what keeps real user recipes untouchable even
 * when they share a junk-looking name.
 */
export function buildJunkRecipeWhere(
  demoUserId: (typeof users.$inferSelect)["id"] | null,
) {
  const authorIdCondition = demoUserId
    ? or(
        isNull(communityRecipes.authorId),
        eq(communityRecipes.authorId, demoUserId),
      )
    : isNull(communityRecipes.authorId);

  return and(
    authorIdCondition,
    or(
      // `seed-*` → seed script output
      ilike(communityRecipes.normalizedProductName, `${SEED_PREFIX}%`),
      // `test-*` → Vitest test factories / insert helpers
      ilike(communityRecipes.normalizedProductName, `${TEST_PREFIX}%`),
      // Back-compat for pre-convention dev DBs
      inArray(
        communityRecipes.normalizedProductName,
        LEGACY_TEST_PRODUCT_NAMES,
      ),
    ),
  );
}

/** CLI contract: dry-run by default; deletion only on an explicit --commit. */
export function parseArgs(argv: string[]): { commit: boolean } {
  const commit = argv.includes("--commit");
  return { commit };
}
