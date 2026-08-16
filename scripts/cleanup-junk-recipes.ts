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
 * Usage: npx tsx scripts/cleanup-junk-recipes.ts            # dry-run (default)
 *        npx tsx scripts/cleanup-junk-recipes.ts --commit   # actually delete
 */
import "dotenv/config";
import { db } from "../server/db";
import { communityRecipes, cookbookRecipes } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import {
  buildJunkCommunityRecipeWhere,
  parseCleanupFlags,
} from "./cleanup-junk-recipes-utils";

// Dry-run by DEFAULT — pass --commit to actually delete.
const { commit: COMMIT } = parseCleanupFlags(process.argv);

async function main() {
  console.log(
    COMMIT ? "=== LIVE RUN ===" : "=== DRY RUN ===  (pass --commit to delete)",
  );

  // Find junk recipes
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      authorId: communityRecipes.authorId,
    })
    .from(communityRecipes)
    .where(buildJunkCommunityRecipeWhere());

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
    // Delete the recipes
    for (const id of ids) {
      await tx.delete(communityRecipes).where(eq(communityRecipes.id, id));
    }
  });

  console.log(
    `Deleted ${ids.length} junk recipes and associated cookbook entries.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
