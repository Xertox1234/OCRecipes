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
import { sql } from "drizzle-orm";
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

  const updates = recipes.map((recipe) => ({
    id: recipe.id,
    allergens: deriveRecipeAllergens(
      (recipe.ingredients ?? []).map((i) => i.name),
    ),
  }));

  if (DRY_RUN) {
    for (const { id, allergens } of updates) {
      console.log(`[dry-run] community ${id}: ${allergens.length} allergen(s)`);
    }
    return updates.length;
  }

  if (updates.length === 0) return 0;

  // Single round-trip via `UPDATE … FROM (VALUES …)` (rule #19) — mirrors
  // `batchUpdateMealTypes`. `JSON.stringify` is safe because Drizzle's `sql`
  // tag parameterizes the values; the `::jsonb` cast stores `[]` as an empty
  // JSONB array, not a string. Rows absent from VALUES keep their existing
  // value, preserving the null = "not derived" semantics on untouched rows.
  const valueTuples = updates.map(
    (u) => sql`(${u.id}::int, ${JSON.stringify(u.allergens)}::jsonb)`,
  );
  await db.execute(
    sql`UPDATE ${communityRecipes}
        SET allergens = v.allergens
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, allergens)
        WHERE ${communityRecipes.id} = v.id`,
  );

  return updates.length;
}

async function backfillMealPlanRecipes(): Promise<number> {
  // Reuse the existing ingredient-fetch path — keyed by recipeId.
  const ingredientMap = await storage.getAllRecipeIngredients();
  const recipes = await db
    .select({ id: mealPlanRecipes.id })
    .from(mealPlanRecipes);

  const updates = recipes.map((recipe) => {
    const ingredientNames = (ingredientMap.get(recipe.id) ?? []).map(
      (i) => i.name,
    );
    return { id: recipe.id, allergens: deriveRecipeAllergens(ingredientNames) };
  });

  if (DRY_RUN) {
    for (const { id, allergens } of updates) {
      console.log(`[dry-run] meal-plan ${id}: ${allergens.length} allergen(s)`);
    }
    return updates.length;
  }

  if (updates.length === 0) return 0;

  // Single round-trip via `UPDATE … FROM (VALUES …)` (rule #19) — mirrors
  // `batchUpdateMealTypes`. See the community arm above for the null-vs-empty
  // and parameterization notes.
  const valueTuples = updates.map(
    (u) => sql`(${u.id}::int, ${JSON.stringify(u.allergens)}::jsonb)`,
  );
  await db.execute(
    sql`UPDATE ${mealPlanRecipes}
        SET allergens = v.allergens
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, allergens)
        WHERE ${mealPlanRecipes.id} = v.id`,
  );

  return updates.length;
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
