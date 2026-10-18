/* eslint-disable no-console */
/**
 * Backfill: derives the denormalized `allergens` and `diet_conflicts` caches
 * for every community + meal-plan recipe from its ingredient names.
 *
 * Uses the zero-API-cost keyword engines `deriveRecipeAllergens`
 * (shared/constants/allergens.ts) and `deriveRecipeDietConflicts`
 * (shared/constants/diet-conflicts.ts) — no AI, no manual labeling. Pairs with
 * the `0003_recipe_allergens.sql` and `0028_recipe_diet_conflicts.sql`
 * migrations that add the two jsonb columns. New/edited recipes recompute both
 * columns on the storage write paths; run this after applying a migration, and
 * re-run it after any keyword-list change — that is the supported path for
 * refreshing stored rows.
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
import {
  deriveRecipeDietConflicts,
  type DietConflictId,
} from "@shared/constants/diet-conflicts";
import { storage } from "../storage";

const DRY_RUN = process.env.DRY_RUN === "1";

interface CacheUpdate {
  id: number;
  allergens: DerivedRecipeAllergen[];
  dietConflicts: DietConflictId[] | null;
}

// Postgres caps bind parameters at ~65535 per query; each VALUES tuple binds 3
// (1000 × 3 stays well under it), so flush in chunks rather than one unbounded
// UPDATE.
const CHUNK_SIZE = 1000;

// Single round-trip per chunk via `UPDATE … FROM (VALUES …)` (rule #19) —
// mirrors `batchUpdateMealTypes`. This is an all-rows backfill: every row is
// re-derived and rewritten, so previously-null rows become `[]` ("derived, no
// allergens") and are never left null. `diet_conflicts` stays null only for a
// recipe with no ingredients ("unchecked"). `JSON.stringify` values are
// parameterized by Drizzle's `sql` tag; the `::jsonb` cast stores `[]` as a
// real empty JSONB array, not the string "[]".
async function applyCacheUpdates(
  table: typeof communityRecipes | typeof mealPlanRecipes,
  updates: CacheUpdate[],
): Promise<void> {
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const valueTuples = chunk.map(
      (u) =>
        sql`(${u.id}::int, ${JSON.stringify(u.allergens)}::jsonb, ${u.dietConflicts === null ? null : JSON.stringify(u.dietConflicts)}::jsonb)`,
    );
    await db.execute(
      sql`UPDATE ${table}
          SET allergens = v.allergens, diet_conflicts = v.diet_conflicts
          FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, allergens, diet_conflicts)
          WHERE ${table.id} = v.id`,
    );
  }
}

function deriveCaches(id: number, names: string[]): CacheUpdate {
  return {
    id,
    allergens: deriveRecipeAllergens(names),
    dietConflicts: deriveRecipeDietConflicts(names),
  };
}

function dryRunLine(kind: string, u: CacheUpdate): string {
  const conflicts =
    u.dietConflicts === null
      ? "unchecked"
      : u.dietConflicts.join(",") || "none";
  return `[dry-run] ${kind} ${u.id}: ${u.allergens.length} allergen(s), diet conflicts: ${conflicts}`;
}

async function backfillCommunityRecipes(): Promise<number> {
  const recipes = await db
    .select({
      id: communityRecipes.id,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes);

  const updates = recipes.map((recipe) =>
    deriveCaches(
      recipe.id,
      (recipe.ingredients ?? []).map((i) => i.name),
    ),
  );

  if (DRY_RUN) {
    for (const u of updates) console.log(dryRunLine("community", u));
    return updates.length;
  }

  await applyCacheUpdates(communityRecipes, updates);
  return updates.length;
}

async function backfillMealPlanRecipes(): Promise<number> {
  // Reuse the existing ingredient-fetch path — keyed by recipeId.
  const ingredientMap = await storage.getAllRecipeIngredients();
  const recipes = await db
    .select({ id: mealPlanRecipes.id })
    .from(mealPlanRecipes);

  const updates = recipes.map((recipe) =>
    deriveCaches(
      recipe.id,
      (ingredientMap.get(recipe.id) ?? []).map((i) => i.name),
    ),
  );

  if (DRY_RUN) {
    for (const u of updates) console.log(dryRunLine("meal-plan", u));
    return updates.length;
  }

  await applyCacheUpdates(mealPlanRecipes, updates);
  return updates.length;
}

async function main() {
  const community = await backfillCommunityRecipes();
  const mealPlan = await backfillMealPlanRecipes();
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Backfilled allergens + diet conflicts on ${community} community + ${mealPlan} meal-plan recipe(s).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
