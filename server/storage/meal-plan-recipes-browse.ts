import {
  type MealPlanRecipe,
  mealPlanRecipes,
  recipeIngredients,
  communityRecipes,
} from "@shared/schema";
// Import directly from the sub-module, not the `./community` barrel, so this
// sub-module never depends on the barrel (avoids latent circular-import risk).
import { FEATURED_COLUMNS, type FeaturedRecipe } from "./community-recipes";
import { db } from "../db";
import { eq, desc, and, or, ilike, inArray, sql } from "drizzle-orm";
import { escapeLike } from "./helpers";
import {
  addToIndex,
  getDocumentStore,
  type SearchIndexableMealPlanRecipe,
} from "../lib/search-index";

/**
 * Display columns for the unified recipe browser (personal arm).
 * Mirrors FEATURED_COLUMNS for community recipes — excludes the heavy
 * `instructions` JSONB column since browser cards never render step-by-step instructions.
 */
const UNIFIED_PERSONAL_COLUMNS = {
  id: mealPlanRecipes.id,
  userId: mealPlanRecipes.userId,
  title: mealPlanRecipes.title,
  description: mealPlanRecipes.description,
  sourceType: mealPlanRecipes.sourceType,
  sourceUrl: mealPlanRecipes.sourceUrl,
  externalId: mealPlanRecipes.externalId,
  cuisine: mealPlanRecipes.cuisine,
  difficulty: mealPlanRecipes.difficulty,
  servings: mealPlanRecipes.servings,
  prepTimeMinutes: mealPlanRecipes.prepTimeMinutes,
  cookTimeMinutes: mealPlanRecipes.cookTimeMinutes,
  imageUrl: mealPlanRecipes.imageUrl,
  dietTags: mealPlanRecipes.dietTags,
  mealTypes: mealPlanRecipes.mealTypes,
  allergens: mealPlanRecipes.allergens,
  caloriesPerServing: mealPlanRecipes.caloriesPerServing,
  proteinPerServing: mealPlanRecipes.proteinPerServing,
  carbsPerServing: mealPlanRecipes.carbsPerServing,
  fatPerServing: mealPlanRecipes.fatPerServing,
  fiberPerServing: mealPlanRecipes.fiberPerServing,
  sugarPerServing: mealPlanRecipes.sugarPerServing,
  sodiumPerServing: mealPlanRecipes.sodiumPerServing,
  createdAt: mealPlanRecipes.createdAt,
  updatedAt: mealPlanRecipes.updatedAt,
} as const;

/** Personal recipe row without heavy `instructions` JSONB. */
export type PersonalRecipeBrief = Omit<MealPlanRecipe, "instructions">;

/**
 * Load all meal-plan recipes for search index initialization.
 * No user filter — returns every recipe in the table.
 * Skips heavy JSONB columns (instructions, normalizedProductName) that the
 * index never consumes.
 */
export async function getAllMealPlanRecipes(): Promise<
  SearchIndexableMealPlanRecipe[]
> {
  return db
    .select({
      id: mealPlanRecipes.id,
      userId: mealPlanRecipes.userId,
      title: mealPlanRecipes.title,
      description: mealPlanRecipes.description,
      cuisine: mealPlanRecipes.cuisine,
      dietTags: mealPlanRecipes.dietTags,
      mealTypes: mealPlanRecipes.mealTypes,
      allergens: mealPlanRecipes.allergens,
      difficulty: mealPlanRecipes.difficulty,
      prepTimeMinutes: mealPlanRecipes.prepTimeMinutes,
      cookTimeMinutes: mealPlanRecipes.cookTimeMinutes,
      caloriesPerServing: mealPlanRecipes.caloriesPerServing,
      proteinPerServing: mealPlanRecipes.proteinPerServing,
      carbsPerServing: mealPlanRecipes.carbsPerServing,
      fatPerServing: mealPlanRecipes.fatPerServing,
      servings: mealPlanRecipes.servings,
      imageUrl: mealPlanRecipes.imageUrl,
      sourceUrl: mealPlanRecipes.sourceUrl,
      createdAt: mealPlanRecipes.createdAt,
    })
    .from(mealPlanRecipes)
    .orderBy(desc(mealPlanRecipes.createdAt));
}

/**
 * Load all recipe ingredients, keyed by recipeId, for search index initialization.
 * Only fetches recipeId + name — the search index only needs ingredient names.
 */
export async function getAllRecipeIngredients(): Promise<
  Map<number, { recipeId: number; name: string }[]>
> {
  const rows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
    })
    .from(recipeIngredients)
    .orderBy(recipeIngredients.recipeId, recipeIngredients.displayOrder);

  const map = new Map<number, { recipeId: number; name: string }[]>();
  for (const row of rows) {
    const existing = map.get(row.recipeId);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.recipeId, [row]);
    }
  }
  return map;
}

export async function getUnifiedRecipes(params: {
  userId: string;
  query?: string;
  cuisine?: string;
  diet?: string;
  mealType?: string;
  limit?: number;
}): Promise<{ community: FeaturedRecipe[]; personal: PersonalRecipeBrief[] }> {
  const { userId, query, cuisine, diet, mealType } = params;
  // Limit is applied independently to each source, so the total result
  // set may contain up to 2x this value (community + personal).
  const resultLimit = Math.min(params.limit ?? 50, 100);

  const communityConditions = [
    eq(communityRecipes.isPublic, true),
    // Quality gate: exclude recipes with empty instructions
    sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) > 0`,
  ];
  const personalConditions = [
    eq(mealPlanRecipes.userId, userId),
    // Quality gate: exclude recipes with no instructions AND no ingredients
    sql`(
      COALESCE(jsonb_array_length(${mealPlanRecipes.instructions}), 0) > 0
      OR EXISTS (
        SELECT 1 FROM ${recipeIngredients}
        WHERE ${recipeIngredients.recipeId} = ${mealPlanRecipes.id}
      )
    )`,
  ];

  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    communityConditions.push(
      or(
        ilike(communityRecipes.title, pattern),
        ilike(communityRecipes.description, pattern),
      )!,
    );
    personalConditions.push(
      or(
        ilike(mealPlanRecipes.title, pattern),
        ilike(mealPlanRecipes.description, pattern),
      )!,
    );
  }

  if (cuisine) {
    // Community recipes have no cuisine column -- filter by dietTags which
    // contain the lowercase cuisine name (e.g. "italian", "mexican").
    communityConditions.push(
      sql`${communityRecipes.dietTags}::jsonb @> ${JSON.stringify([cuisine.toLowerCase()])}::jsonb`,
    );
    personalConditions.push(
      ilike(mealPlanRecipes.cuisine, `%${escapeLike(cuisine)}%`),
    );
  }

  if (diet) {
    const dietLower = diet.toLowerCase();
    communityConditions.push(
      sql`${communityRecipes.dietTags}::jsonb @> ${JSON.stringify([dietLower])}::jsonb`,
    );
    personalConditions.push(
      sql`${mealPlanRecipes.dietTags}::jsonb @> ${JSON.stringify([dietLower])}::jsonb`,
    );
  }

  if (mealType) {
    // Symmetric meal-type filter. Commit 945df21 (M9 / 2026-04-17) added
    // `mealTypes` to community_recipes + a GIN index; the previous "return
    // community unfiltered" branch was stale. Allow empty/null mealTypes
    // through so pre-backfill rows stay visible until classified.
    const mealTypeMatch = or(
      sql`${mealPlanRecipes.mealTypes}::jsonb @> ${JSON.stringify([mealType])}::jsonb`,
      sql`${mealPlanRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${mealPlanRecipes.mealTypes} IS NULL`,
    )!;
    personalConditions.push(mealTypeMatch);
    communityConditions.push(
      or(
        sql`${communityRecipes.mealTypes}::jsonb @> ${JSON.stringify([mealType])}::jsonb`,
        sql`${communityRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${communityRecipes.mealTypes} IS NULL`,
      )!,
    );
  }

  const [community, personal] = await Promise.all([
    db
      .select(FEATURED_COLUMNS)
      .from(communityRecipes)
      .where(and(...communityConditions))
      .orderBy(desc(communityRecipes.createdAt))
      .limit(resultLimit),
    db
      .select(UNIFIED_PERSONAL_COLUMNS)
      .from(mealPlanRecipes)
      .where(and(...personalConditions))
      .orderBy(desc(mealPlanRecipes.createdAt))
      .limit(resultLimit),
  ]);

  return { community, personal };
}

// ============================================================================
// MEAL TYPE BACKFILL (used by meal-type-inference service)
// ============================================================================

/**
 * Get recipes with empty or null mealTypes, along with their ingredients.
 * Used by the meal-type inference backfill job.
 *
 * Defense-in-depth (L28): if a `discardedAt` soft-delete column is ever added
 * to `mealPlanRecipes`, add `isNull(mealPlanRecipes.discardedAt)` to the where
 * clause below so discarded recipes are excluded from backfill processing.
 */
export async function getRecipesWithEmptyMealTypes(): Promise<{
  recipes: { id: number; title: string }[];
  ingredientsByRecipe: Map<number, string[]>;
}> {
  const recipes = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
    })
    .from(mealPlanRecipes)
    .where(
      sql`${mealPlanRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${mealPlanRecipes.mealTypes} IS NULL`,
    );

  if (recipes.length === 0) {
    return { recipes: [], ingredientsByRecipe: new Map() };
  }

  const recipeIds = recipes.map((r) => r.id);
  // `inArray` — not `sql`...ANY(${recipeIds})``: Drizzle's `sql` tag does not
  // cast a JS number[] to a PG int array, so the raw-ANY form fails at runtime
  // with "malformed array literal" once `recipes` is non-empty. Surfaced by
  // todos/2026-05-15-meal-plan-recipes-tests.md.
  const allIngredients = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
    })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, recipeIds));

  const ingredientsByRecipe = new Map<number, string[]>();
  for (const ing of allIngredients) {
    const existing = ingredientsByRecipe.get(ing.recipeId) ?? [];
    existing.push(ing.name);
    ingredientsByRecipe.set(ing.recipeId, existing);
  }

  return { recipes, ingredientsByRecipe };
}

/**
 * Update mealTypes for multiple recipes in a single round-trip and refresh
 * any affected entries in the MiniSearch index so callers see the new
 * classifications without a server restart. (H8 — 2026-04-18: was a per-row
 * UPDATE loop that also skipped the index refresh, leaving the in-memory
 * index stale until the next boot.)
 */
export async function batchUpdateMealTypes(
  updates: { id: number; mealTypes: string[] }[],
): Promise<number> {
  if (updates.length === 0) return 0;

  // Single round-trip via `UPDATE … FROM (VALUES …)` — matches the DB-level
  // write shape used elsewhere (see the seed + backfill paths). JSON.stringify
  // is safe here because Drizzle's `sql` tag parameterizes the values.
  const valueTuples = updates.map(
    (u) => sql`(${u.id}::int, ${JSON.stringify(u.mealTypes)}::jsonb)`,
  );
  await db.execute(
    sql`UPDATE ${mealPlanRecipes}
        SET meal_types = v.meal_types, updated_at = NOW()
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, meal_types)
        WHERE ${mealPlanRecipes.id} = v.id`,
  );

  // Refresh in-memory search index for any previously-indexed docs.
  // `addToIndex` replaces the existing entry so searches see new mealTypes
  // immediately. Docs not yet in the index (cold boot) are no-op.
  const store = getDocumentStore();
  for (const { id, mealTypes } of updates) {
    const existing = store.get(`personal:${id}`);
    if (existing) addToIndex({ ...existing, mealTypes });
  }

  return updates.length;
}
