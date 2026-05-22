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
import {
  deriveRecipeAllergens,
  type DerivedRecipeAllergen,
} from "@shared/constants/allergens";
import { storage } from "../storage";

const DRY_RUN = process.env.DRY_RUN === "1";

// Postgres caps bind parameters at ~65535 per query; each VALUES tuple binds 2,
// so flush in chunks well under that ceiling rather than one unbounded UPDATE.
const CHUNK_SIZE = 1000;

// Single round-trip per chunk via `UPDATE … FROM (VALUES …)` (rule #19) —
// mirrors `batchUpdateMealTypes`. This is an all-rows backfill: every row is
// re-derived and rewritten, so previously-null rows become `[]` ("derived, no
// allergens") and are never left null. `JSON.stringify` values are
// parameterized by Drizzle's `sql` tag; the `::jsonb` cast stores `[]` as a
// real empty JSONB array, not the string "[]".
async function applyAllergenUpdates(
  table: typeof communityRecipes | typeof mealPlanRecipes,
  updates: { id: number; allergens: DerivedRecipeAllergen[] }[],
): Promise<void> {
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const valueTuples = chunk.map(
      (u) => sql`(${u.id}::int, ${JSON.stringify(u.allergens)}::jsonb)`,
    );
    await db.execute(
      sql`UPDATE ${table}
          SET allergens = v.allergens
          FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, allergens)
          WHERE ${table.id} = v.id`,
    );
  }
}

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

  await applyAllergenUpdates(communityRecipes, updates);
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

  await applyAllergenUpdates(mealPlanRecipes, updates);
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
