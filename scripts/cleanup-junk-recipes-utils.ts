/**
 * Pure helpers for `cleanup-junk-recipes.ts` — the DB-free leaf (policy:
 * docs/solutions/design-patterns/db-free-policy-leaf-module-for-operator-
 * tooling-2026-07-24.md). The script runs `main()` at module load and cannot
 * be imported in a test; the deletion predicate lives here so the suite
 * asserts on the exact SQL the script executes.
 */
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { communityRecipes, users } from "../shared/schema";

/**
 * The deletion perimeter. Scoped to orphan (`authorId IS NULL`) or
 * demo-authored rows — mirroring `cleanup-seed-recipes-utils.ts`'s
 * `authorIdCondition` — ANDed with any of the junk criteria:
 *   - title is exactly "test recipe" (case-insensitive, NO wildcards)
 *   - trimmed title under 3 characters. Kept in scope deliberately: a
 *     legitimate short title like "GF" could match, but under this author
 *     scope it can only ever delete an orphan (`authorId IS NULL` — note
 *     `authorId` is `onDelete: "set null"`, so this includes recipes left
 *     behind by a deleted account, not only seed/test cruft) or a
 *     demo-authored row — never a live real user's recipe. That residual
 *     is the same one the sibling `cleanup-seed-recipes` script's orphan
 *     scope already accepts, and is a large reduction from the prior
 *     no-scoping perimeter (deletable regardless of author). Decided here
 *     rather than raising the threshold, since the author scope already
 *     closes the live-user blast radius.
 *   - empty instructions AND empty ingredients (both — a draft with only
 *     instructions must survive)
 */
export function buildJunkCommunityRecipeWhere(
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
      // Exact "Test Recipe" match (case-insensitive)
      ilike(communityRecipes.title, "test recipe"),
      // Title under 3 chars
      sql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
      // Empty instructions AND empty ingredients
      and(
        sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) = 0`,
        sql`COALESCE(jsonb_array_length(${communityRecipes.ingredients}), 0) = 0`,
      ),
    ),
  );
}

/**
 * CLI contract: preview by default; deletion only on an explicit --commit,
 * and `--dry-run` is a VETO — it wins even alongside --commit, so a stale
 * habitual --dry-run in a saved command stays a safety net rather than being
 * silently ignored (the safe failure direction in every combination).
 * `vetoed` reports the conflict so the script's banner can NAME --dry-run as
 * the reason, instead of telling the operator to pass a --commit they
 * already passed.
 */
export function parseCleanupFlags(argv: readonly string[]): {
  commit: boolean;
  vetoed: boolean;
} {
  const commitRequested = argv.includes("--commit");
  const dryRun = argv.includes("--dry-run");
  return {
    commit: commitRequested && !dryRun,
    vetoed: commitRequested && dryRun,
  };
}
