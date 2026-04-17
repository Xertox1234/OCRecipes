/* eslint-disable no-console */
/**
 * Cleanup script: removes seed-generated AND leaked test community recipes,
 * along with their associated image files, generation logs, cookbook refs,
 * and favourites.
 *
 * Identifies junk by:
 *   - normalizedProductName starting with "seed-"  (seed script output)
 *   - normalizedProductName in known test patterns  (Vitest test data leaks)
 *
 * Usage: npm run cleanup:seeds
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import {
  communityRecipes,
  recipeGenerationLog,
  cookbookRecipes,
  favouriteRecipes,
  recipeDismissals,
  users,
} from "@shared/schema";
import { eq, and, ilike, inArray, or, sql, isNull } from "drizzle-orm";

const RECIPE_IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");

const TEST_PRODUCT_NAMES = ["test product", "test food", "original pasta"];

async function main() {
  console.log("=== Cleanup Junk Recipes ===\n");

  // Resolve demo user ID so we can restrict deletion to orphan/demo-authored
  // rows and NEVER touch real user recipes that happen to share a test name.
  const demoUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "demo"));
  const demoUserId = demoUserRows[0]?.id ?? null;

  const authorIdCondition = demoUserId
    ? or(
        isNull(communityRecipes.authorId),
        eq(communityRecipes.authorId, demoUserId),
      )
    : isNull(communityRecipes.authorId);

  // Find all junk recipes: seeds + leaked test data — scoped to orphan or demo author
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      normalizedProductName: communityRecipes.normalizedProductName,
      imageUrl: communityRecipes.imageUrl,
    })
    .from(communityRecipes)
    .where(
      and(
        authorIdCondition,
        or(
          ilike(communityRecipes.normalizedProductName, "seed-%"),
          inArray(communityRecipes.normalizedProductName, TEST_PRODUCT_NAMES),
        ),
      ),
    );

  if (junkRecipes.length === 0) {
    console.log("No junk recipes found. Database is clean.");
    await pool.end();
    return;
  }

  const seedCount = junkRecipes.filter((r) =>
    r.normalizedProductName.startsWith("seed-"),
  ).length;
  const testCount = junkRecipes.length - seedCount;

  console.log(
    `Found ${junkRecipes.length} junk recipes to remove (${seedCount} seeds, ${testCount} test leaks)\n`,
  );

  const junkIds = junkRecipes.map((r) => r.id);

  // Delete in batches of 500 to avoid parameter limit issues
  const BATCH = 500;
  let totalDeleted = 0;

  for (let i = 0; i < junkIds.length; i += BATCH) {
    const batch = junkIds.slice(i, i + BATCH);

    await db.transaction(async (tx) => {
      await tx
        .delete(recipeGenerationLog)
        .where(inArray(recipeGenerationLog.recipeId, batch));

      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, batch),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );

      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            inArray(favouriteRecipes.recipeId, batch),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );

      const dismissalIdentifiers = batch.map(String);
      await tx
        .delete(recipeDismissals)
        .where(
          inArray(recipeDismissals.recipeIdentifier, dismissalIdentifiers),
        );

      const result = await tx
        .delete(communityRecipes)
        .where(inArray(communityRecipes.id, batch))
        .returning({ id: communityRecipes.id });

      totalDeleted += result.length;
    });
  }

  console.log(`Deleted ${totalDeleted} community recipes`);

  // Clean up image files on disk
  let imagesDeleted = 0;
  for (const r of junkRecipes) {
    if (!r.imageUrl) continue;
    const filename = r.imageUrl.replace("/api/recipe-images/", "");
    const filepath = path.join(RECIPE_IMAGES_DIR, filename);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        imagesDeleted++;
      }
    } catch (err) {
      console.warn(`  Warning: could not delete ${filepath}:`, err);
    }
  }
  if (imagesDeleted > 0) {
    console.log(`Deleted ${imagesDeleted} image files from disk`);
  }

  // Report remaining recipe count
  const remaining = await db
    .select({ count: sql<number>`count(*)` })
    .from(communityRecipes);
  console.log(`\nRemaining community recipes: ${remaining[0]?.count}`);

  console.log("\n=== Cleanup complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
