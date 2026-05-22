import { communityRecipes } from "@shared/schema";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { addToIndex, getDocumentStore } from "../lib/search-index";

// ============================================================================
// MEAL TYPE BACKFILL (used by backfill-community-meal-types script)
// ============================================================================

/**
 * Get community recipes with empty or null mealTypes. Returns the data needed
 * to infer mealTypes (title + ingredient names).
 *
 * Note: community recipe ingredients live in the JSONB `ingredients` column
 * (unlike meal-plan recipes which use a separate `recipe_ingredients` table),
 * so there's no join here.
 *
 * Defense-in-depth (L28): if a `discardedAt` soft-delete column is ever added
 * to `communityRecipes`, add `isNull(communityRecipes.discardedAt)` to the
 * where clause below so discarded recipes are excluded from backfill processing.
 */
export async function getCommunityRecipesWithEmptyMealTypes(): Promise<
  {
    id: number;
    title: string;
    ingredients: { name: string; quantity: string; unit: string }[] | null;
  }[]
> {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes)
    .where(
      sql`${communityRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${communityRecipes.mealTypes} IS NULL`,
    );
}

/**
 * Update mealTypes for multiple community recipes in a single round-trip and
 * refresh the MiniSearch index so the backfill is visible without a server
 * restart. (H8 — 2026-04-18: was a per-row UPDATE loop with no index call.)
 */
export async function batchUpdateCommunityMealTypes(
  updates: { id: number; mealTypes: string[] }[],
): Promise<number> {
  if (updates.length === 0) return 0;

  const valueTuples = updates.map(
    (u) => sql`(${u.id}::int, ${JSON.stringify(u.mealTypes)}::jsonb)`,
  );
  await db.execute(
    sql`UPDATE ${communityRecipes}
        SET meal_types = v.meal_types, updated_at = NOW()
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, meal_types)
        WHERE ${communityRecipes.id} = v.id`,
  );

  const store = getDocumentStore();
  for (const { id, mealTypes } of updates) {
    const existing = store.get(`community:${id}`);
    if (existing) addToIndex({ ...existing, mealTypes });
  }

  return updates.length;
}
