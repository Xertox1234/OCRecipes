// scripts/cleanup-junk-recipes.ts
/**
 * One-time script to delete junk community recipes from the database.
 *
 * Criteria for junk (predicate lives in cleanup-junk-recipes-utils, where it
 * is unit-tested):
 * - Title is exactly "Test Recipe" (case-insensitive)
 * - Title is under 3 characters
 * - Empty instructions AND empty ingredients
 *
 * Safety:
 *   - Defaults to DRY-RUN. Pass `--commit` to actually delete.
 *   - Scoped to orphan (authorId IS NULL), or the account currently holding
 *     the username `demo`. NOT an absolute real-user exclusion: `demo` is not
 *     a reserved username (`registerSchema` in `server/routes/_schemas.ts`
 *     enforces only 3-30 chars, `/^[a-zA-Z0-9_]+$/`, and uniqueness), so where
 *     no demo account was seeded first a real user can hold it. See
 *     `docs/solutions/conventions/seed-cleanup-scripts-scope-by-authorid-2026-05-13.md`.
 *
 * Usage: npx tsx scripts/cleanup-junk-recipes.ts            # dry-run (default)
 *        npx tsx scripts/cleanup-junk-recipes.ts --commit   # actually delete
 *        (--dry-run vetoes --commit if both are passed)
 */
import "dotenv/config";
import { db } from "../server/db";
import { communityRecipes, cookbookRecipes, users } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import {
  buildJunkCommunityRecipeWhere,
  parseCleanupFlags,
} from "./cleanup-junk-recipes-utils";

// Dry-run by DEFAULT — pass --commit (without --dry-run, which vetoes it)
// to actually delete.
const { commit: COMMIT, vetoed: VETOED } = parseCleanupFlags(process.argv);

async function main() {
  console.log(
    COMMIT
      ? "=== LIVE RUN ==="
      : VETOED
        ? "=== DRY RUN ===  (--dry-run overrides --commit; drop --dry-run to delete)"
        : "=== DRY RUN ===  (pass --commit to delete)",
  );

  // Resolve the demo user ID so deletion is restricted to orphan rows or rows
  // authored by whoever currently holds the username `demo`, instead of every
  // row that happens to share a junk-looking title or content. `demo` is not a
  // reserved username, so this narrows the blast radius rather than closing it
  // — see the header comment.
  const demoUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "demo"));
  const demoUserId = demoUserRows[0]?.id ?? null;
  console.log(
    demoUserId
      ? `Demo user resolved: ${demoUserId} (scope: orphan OR demo-authored)`
      : "Demo user NOT found (scope: orphan-only — narrower, never wider)",
  );

  // Find junk recipes
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      authorId: communityRecipes.authorId,
    })
    .from(communityRecipes)
    .where(buildJunkCommunityRecipeWhere(demoUserId));

  console.log(`Found ${junkRecipes.length} junk recipes:`);
  for (const r of junkRecipes) {
    console.log(
      `  ID=${r.id} title="${r.title}" author=${r.authorId ?? "NULL"}`,
    );
  }

  if (!COMMIT || junkRecipes.length === 0) {
    console.log("No changes made.");
    process.exit(0);
  }

  // Delete in transaction
  const ids = junkRecipes.map((r) => r.id);
  await db.transaction(async (tx) => {
    // Clean up cookbook junction rows first
    for (const id of ids) {
      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, id),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );
    }
    // Delete the recipes. Defense in depth: re-apply the full perimeter at the
    // destructive statement rather than trusting the id list the SELECT
    // produced, so a row that stopped qualifying between the two statements is
    // not deleted on the strength of its primary key alone.
    for (const id of ids) {
      await tx
        .delete(communityRecipes)
        .where(
          and(
            eq(communityRecipes.id, id),
            buildJunkCommunityRecipeWhere(demoUserId),
          ),
        );
    }
  });

  console.log(
    `Deleted up to ${ids.length} junk recipes and associated cookbook entries.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
