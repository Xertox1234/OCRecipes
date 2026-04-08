// scripts/backfill-recipe-images.ts
/**
 * One-time script to generate images for existing imageless recipes.
 * Processes sequentially with delay to avoid rate limits.
 *
 * Usage: npx tsx scripts/backfill-recipe-images.ts
 * Add --dry-run to preview what would be updated without generating.
 * Add --delay=5000 to set delay between generations in ms (default: 3000).
 * Add --limit=10 to limit the number of recipes processed.
 */
import "dotenv/config";
import { db } from "../server/db";
import { communityRecipes, mealPlanRecipes } from "../shared/schema";
import { isNull, eq } from "drizzle-orm";
import { generateRecipeImage } from "../server/services/recipe-generation";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = parseInt(
  process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? "3000",
  10,
);
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "999999",
  10,
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log(`Delay: ${DELAY_MS}ms, Limit: ${LIMIT}`);

  // Find imageless community recipes
  const imagelessCommunity = await db
    .select({ id: communityRecipes.id, title: communityRecipes.title })
    .from(communityRecipes)
    .where(isNull(communityRecipes.imageUrl))
    .limit(LIMIT);

  // Find imageless meal plan recipes
  const imagelessMealPlan = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
      userId: mealPlanRecipes.userId,
    })
    .from(mealPlanRecipes)
    .where(isNull(mealPlanRecipes.imageUrl))
    .limit(LIMIT);

  const totalCount = imagelessCommunity.length + imagelessMealPlan.length;
  console.log(
    `Found ${imagelessCommunity.length} community + ${imagelessMealPlan.length} meal plan = ${totalCount} imageless recipes`,
  );

  if (DRY_RUN || totalCount === 0) {
    for (const r of imagelessCommunity)
      console.log(`  [community] ID=${r.id} "${r.title}"`);
    for (const r of imagelessMealPlan)
      console.log(`  [meal-plan] ID=${r.id} "${r.title}"`);
    console.log("No changes made.");
    process.exit(0);
  }

  let success = 0;
  let failed = 0;

  // Process community recipes
  for (const recipe of imagelessCommunity) {
    try {
      console.log(
        `Generating image for community recipe ${recipe.id}: "${recipe.title}"...`,
      );
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await db
          .update(communityRecipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(communityRecipes.id, recipe.id));
        success++;
        console.log(`  Done: ${imageUrl}`);
      } else {
        failed++;
        console.log(`  Failed: No image returned`);
      }
    } catch (err) {
      failed++;
      console.error(`  Failed:`, err);
    }
    await sleep(DELAY_MS);
  }

  // Process meal plan recipes
  for (const recipe of imagelessMealPlan) {
    try {
      console.log(
        `Generating image for meal-plan recipe ${recipe.id}: "${recipe.title}"...`,
      );
      const imageUrl = await generateRecipeImage(recipe.title, recipe.title);
      if (imageUrl) {
        await db
          .update(mealPlanRecipes)
          .set({ imageUrl, updatedAt: new Date() })
          .where(eq(mealPlanRecipes.id, recipe.id));
        success++;
        console.log(`  Done: ${imageUrl}`);
      } else {
        failed++;
        console.log(`  Failed: No image returned`);
      }
    } catch (err) {
      failed++;
      console.error(`  Failed:`, err);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
