/* eslint-disable no-console */
/**
 * One-time backfill: derives the denormalized `allergens` cache for every
 * community + meal-plan recipe from its ingredient names.
 *
 * Uses the zero-API-cost keyword engine `deriveRecipeAllergens`
 * (shared/constants/allergens.ts) — no AI, no manual labeling. Pairs with the
 * `0003_recipe_allergens.sql` migration that adds the `allergens` jsonb column.
 * New/edited recipes recompute the column on the storage write paths, so this
 * script only needs to run once after `npm run db:push` (or after applying the
 * migration) to populate pre-existing rows.
 *
 * Community-recipe ingredients live in the JSONB `ingredients` column on the
 * row; meal-plan-recipe ingredients live in the separate `recipe_ingredients`
 * table — so the two arms fetch ingredient names differently.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-recipe-allergens.ts
 *   DRY_RUN=1 npx tsx server/scripts/backfill-recipe-allergens.ts
 */
import "dotenv/config";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { deriveRecipeAllergens } from "@shared/constants/allergens";
import { storage } from "../storage";

const DRY_RUN = process.env.DRY_RUN === "1";

async function backfillCommunityRecipes(): Promise<number> {
  const recipes = await db
    .select({
      id: communityRecipes.id,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes);

  let updated = 0;
  for (const recipe of recipes) {
    const allergens = deriveRecipeAllergens(
      (recipe.ingredients ?? []).map((i) => i.name),
    );
    if (DRY_RUN) {
      console.log(
        `[dry-run] community ${recipe.id}: ${allergens.length} allergen(s)`,
      );
    } else {
      await db
        .update(communityRecipes)
        .set({ allergens })
        .where(eq(communityRecipes.id, recipe.id));
    }
    updated++;
  }
  return updated;
}

async function backfillMealPlanRecipes(): Promise<number> {
  // Reuse the existing ingredient-fetch path — keyed by recipeId.
  const ingredientMap = await storage.getAllRecipeIngredients();
  const recipes = await db
    .select({ id: mealPlanRecipes.id })
    .from(mealPlanRecipes);

  let updated = 0;
  for (const recipe of recipes) {
    const ingredientNames = (ingredientMap.get(recipe.id) ?? []).map(
      (i) => i.name,
    );
    const allergens = deriveRecipeAllergens(ingredientNames);
    if (DRY_RUN) {
      console.log(
        `[dry-run] meal-plan ${recipe.id}: ${allergens.length} allergen(s)`,
      );
    } else {
      await db
        .update(mealPlanRecipes)
        .set({ allergens })
        .where(eq(mealPlanRecipes.id, recipe.id));
    }
    updated++;
  }
  return updated;
}

async function main() {
  const community = await backfillCommunityRecipes();
  const mealPlan = await backfillMealPlanRecipes();
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Backfilled allergens on ${community} community + ${mealPlan} meal-plan recipe(s).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
