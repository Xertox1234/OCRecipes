import {
  type MealPlanRecipe,
  type InsertMealPlanRecipe,
  type RecipeIngredient,
  type InsertRecipeIngredient,
  type InsertMealPlanItem,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  communityRecipes,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";
import { FEATURED_COLUMNS, type FeaturedRecipe } from "./community";
import { db } from "../db";
import { eq, desc, and, or, ilike, inArray, sql } from "drizzle-orm";
import { escapeLike } from "./helpers";
import {
  addToIndex,
  removeFromIndex,
  mealPlanToSearchable,
  getDocumentStore,
  type SearchIndexableMealPlanRecipe,
} from "../lib/search-index";

// ============================================================================
// MEAL PLAN RECIPES
// ============================================================================

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

export async function findMealPlanRecipeByExternalId(
  userId: string,
  externalId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.userId, userId),
        eq(mealPlanRecipes.externalId, externalId),
      ),
    );
  return recipe || undefined;
}

export async function getMealPlanRecipe(
  id: number,
  userId?: string,
): Promise<MealPlanRecipe | undefined> {
  const condition = userId
    ? and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId))
    : eq(mealPlanRecipes.id, id);
  const [recipe] = await db.select().from(mealPlanRecipes).where(condition);
  return recipe || undefined;
}

export async function getMealPlanRecipeWithIngredients(
  id: number,
  userId?: string,
): Promise<(MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined> {
  const [recipe, ingredients] = await Promise.all([
    getMealPlanRecipe(id, userId),
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(recipeIngredients.displayOrder),
  ]);

  if (!recipe) return undefined;

  return { ...recipe, ingredients };
}

export async function getUserMealPlanRecipes(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ items: MealPlanRecipe[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId))
      .orderBy(desc(mealPlanRecipes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId)),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function createMealPlanRecipe(
  recipe: InsertMealPlanRecipe,
  ingredients?: InsertRecipeIngredient[],
): Promise<MealPlanRecipe> {
  // mealTypes should be set by the caller (route/service layer).
  // Storage is a pure data-access layer and should not call service functions.

  if (ingredients && ingredients.length > 0) {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(mealPlanRecipes).values(recipe).returning();
      await tx.insert(recipeIngredients).values(
        ingredients.map((ing, idx) => ({
          ...ing,
          recipeId: row.id,
          displayOrder: ing.displayOrder ?? idx,
        })),
      );
      return row;
    });
    // Update search index after transaction commits
    addToIndex(
      mealPlanToSearchable(
        created,
        ingredients.map((i) => i.name),
      ),
    );
    return created;
  }

  const [created] = await db.insert(mealPlanRecipes).values(recipe).returning();
  addToIndex(mealPlanToSearchable(created, []));
  return created;
}

export interface MealPlanSuggestionInput {
  recipe: InsertMealPlanRecipe;
  ingredients: Omit<InsertRecipeIngredient, "recipeId">[];
  planItem: Omit<InsertMealPlanItem, "recipeId">;
}

/**
 * Atomically creates multiple meal plan recipes with their ingredients
 * and plan items. Uses batch inserts to minimize DB round trips.
 */
export async function createMealPlanFromSuggestions(
  meals: MealPlanSuggestionInput[],
): Promise<{ recipeId: number; mealPlanItemId: number }[]> {
  if (meals.length === 0) return [];

  const result = await db.transaction(async (tx) => {
    // Batch-insert all recipes at once
    const recipes = await tx
      .insert(mealPlanRecipes)
      .values(meals.map((m) => m.recipe))
      .returning();

    // Batch-insert all ingredients at once (with correct recipeIds)
    const allIngredients = recipes.flatMap((recipe, i) =>
      meals[i].ingredients.map((ing, idx) => ({
        ...ing,
        recipeId: recipe.id,
        displayOrder: ing.displayOrder ?? idx,
      })),
    );
    if (allIngredients.length > 0) {
      await tx.insert(recipeIngredients).values(allIngredients);
    }

    // Batch-insert all plan items at once
    const planItems = await tx
      .insert(mealPlanItems)
      .values(
        recipes.map((recipe, i) => ({
          ...meals[i].planItem,
          recipeId: recipe.id,
        })),
      )
      .returning();

    return { recipes, allIngredients, planItems };
  });

  // Update search index after transaction commits
  for (const recipe of result.recipes) {
    const ingNames = result.allIngredients
      .filter((i) => i.recipeId === recipe.id)
      .map((i) => i.name);
    addToIndex(mealPlanToSearchable(recipe, ingNames));
  }

  return result.recipes.map((recipe, i) => ({
    recipeId: recipe.id,
    mealPlanItemId: result.planItems[i].id,
  }));
}

type UpdatableMealPlanRecipeFields = Pick<
  InsertMealPlanRecipe,
  | "title"
  | "description"
  | "imageUrl"
  | "servings"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "difficulty"
  | "cuisine"
  | "mealTypes"
>;

export async function updateMealPlanRecipe(
  id: number,
  userId: string,
  updates: Partial<UpdatableMealPlanRecipeFields>,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .update(mealPlanRecipes)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)))
    .returning();
  if (recipe) {
    const ings = await db
      .select({ name: recipeIngredients.name })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id));
    addToIndex(
      mealPlanToSearchable(
        recipe,
        ings.map((i) => i.name),
      ),
    );
  }
  return recipe || undefined;
}

export async function deleteMealPlanRecipe(
  id: number,
  userId: string,
): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    const result = await tx
      .delete(mealPlanRecipes)
      .where(
        and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)),
      )
      .returning({ id: mealPlanRecipes.id });
    if (result.length === 0) return false;

    // Clean up junction rows that referenced this recipe
    await Promise.all([
      tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, id),
            eq(cookbookRecipes.recipeType, "mealPlan"),
          ),
        ),
      tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.recipeId, id),
            eq(favouriteRecipes.recipeType, "mealPlan"),
          ),
        ),
    ]);
    return true;
  });

  // Update search index AFTER transaction commits — if the tx rolls back,
  // we don't want the index to forget a recipe that still exists in the DB.
  if (deleted) removeFromIndex(`personal:${id}`);
  return deleted;
}

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
