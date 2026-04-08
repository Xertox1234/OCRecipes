// scripts/cleanup-junk-recipes.ts
/**
 * One-time script to delete junk community recipes from the database.
 *
 * Criteria for junk:
 * - Title is exactly "Test Recipe" (case-insensitive)
 * - Title is under 3 characters
 * - Empty instructions AND empty ingredients
 *
 * Usage: npx tsx scripts/cleanup-junk-recipes.ts
 * Add --dry-run to preview what would be deleted without actually deleting.
 */
import { db } from "../server/db";
import { communityRecipes, cookbookRecipes } from "../shared/schema";
import { eq, and, sql, or, ilike } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");

  // Find junk recipes
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      authorId: communityRecipes.authorId,
    })
    .from(communityRecipes)
    .where(
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

  console.log(`Found ${junkRecipes.length} junk recipes:`);
  for (const r of junkRecipes) {
    console.log(
      `  ID=${r.id} title="${r.title}" author=${r.authorId ?? "NULL"}`,
    );
  }

  if (DRY_RUN || junkRecipes.length === 0) {
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
