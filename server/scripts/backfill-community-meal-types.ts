/* eslint-disable no-console */
/**
 * One-time backfill: tags existing community recipes with inferred mealTypes.
 *
 * Pairs with `backfill-meal-types.ts` (which handles meal-plan recipes) and
 * complements the M9 audit fix that classifies community recipes at insert
 * time. Run this after `npm run db:push` adds the `meal_types` column to
 * `community_recipes`.
 *
 * Usage: npx tsx server/scripts/backfill-community-meal-types.ts
 */
import "dotenv/config";
import { inferMealTypes } from "../lib/meal-type-inference";
import { storage } from "../storage";
import { pool } from "../db";

async function main() {
  const recipes = await storage.getCommunityRecipesWithEmptyMealTypes();

  if (recipes.length === 0) {
    console.log("No community recipes need backfill.");
    await pool.end();
    return;
  }

  const updates = recipes.map((recipe) => {
    const ingredientNames = (recipe.ingredients ?? []).map((i) => i.name);
    return {
      id: recipe.id,
      mealTypes: inferMealTypes(recipe.title, ingredientNames),
    };
  });

  const updated = await storage.batchUpdateCommunityMealTypes(updates);
  console.log(`Backfilled mealTypes on ${updated} community recipe(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
