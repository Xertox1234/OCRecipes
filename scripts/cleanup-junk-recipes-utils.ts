/**
 * Pure helpers for `cleanup-junk-recipes.ts` — the DB-free leaf (policy:
 * docs/solutions/design-patterns/db-free-policy-leaf-module-for-operator-
 * tooling-2026-07-24.md). The script runs `main()` at module load and cannot
 * be imported in a test; the deletion predicate lives here so the suite
 * asserts on the exact SQL the script executes.
 */
import { and, ilike, or, sql } from "drizzle-orm";
import { communityRecipes } from "../shared/schema";

/**
 * The deletion perimeter. Junk criteria (any of):
 *   - title is exactly "test recipe" (case-insensitive, NO wildcards)
 *   - trimmed title under 3 characters
 *   - empty instructions AND empty ingredients (both — a draft with only
 *     instructions must survive)
 * NOTE: no authorId scoping (unlike cleanup-seed-recipes) — deletes across
 * all users. Surfaced as a follow-up finding, deliberately unchanged here.
 */
export function buildJunkCommunityRecipeWhere() {
  return or(
    // Exact "Test Recipe" match (case-insensitive)
    ilike(communityRecipes.title, "test recipe"),
    // Title under 3 chars
    sql`LENGTH(TRIM(${communityRecipes.title})) < 3`,
    // Empty instructions AND empty ingredients
    and(
      sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) = 0`,
      sql`COALESCE(jsonb_array_length(${communityRecipes.ingredients}), 0) = 0`,
    ),
  );
}

/**
 * CLI contract: preview by default; deletion only on an explicit --commit,
 * and `--dry-run` is a VETO — it wins even alongside --commit, so a stale
 * habitual --dry-run in a saved command stays a safety net rather than being
 * silently ignored (the safe failure direction in every combination).
 */
export function parseCleanupFlags(argv: readonly string[]): {
  commit: boolean;
} {
  return { commit: argv.includes("--commit") && !argv.includes("--dry-run") };
}
