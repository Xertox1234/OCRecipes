import {
  type ScannedItem,
  type MealPlanRecipe,
  type InsertMealPlanRecipe,
  type RecipeIngredient,
  type InsertRecipeIngredient,
  type MealPlanItem,
  type InsertMealPlanItem,
  scannedItems,
  dailyLogs,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  communityRecipes,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";
import { FEATURED_COLUMNS, type FeaturedRecipe } from "./community";
import { toDateString } from "@shared/lib/date";
import { db } from "../db";
import {
  eq,
  desc,
  and,
  gte,
  lte,
  lt,
  ne,
  sql,
  or,
  ilike,
  isNull,
  inArray,
  notInArray,
} from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";
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
// MEAL PLAN ITEMS
// ============================================================================

export async function getMealPlanItems(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<
  (MealPlanItem & {
    recipe: MealPlanRecipe | null;
    scannedItem: ScannedItem | null;
  })[]
> {
  const items = await db
    .select()
    .from(mealPlanItems)
    .where(
      and(
        eq(mealPlanItems.userId, userId),
        gte(mealPlanItems.plannedDate, startDate),
        lte(mealPlanItems.plannedDate, endDate),
      ),
    )
    .orderBy(mealPlanItems.plannedDate, mealPlanItems.createdAt);

  // Batch-fetch related recipes and scanned items
  const recipeIds = [
    ...new Set(items.filter((i) => i.recipeId).map((i) => i.recipeId!)),
  ];
  const scannedItemIds = [
    ...new Set(
      items.filter((i) => i.scannedItemId).map((i) => i.scannedItemId!),
    ),
  ];

  const recipesMap = new Map<number, MealPlanRecipe>();
  const scannedItemsMap = new Map<number, ScannedItem>();

  const [recipes, scanned] = await Promise.all([
    recipeIds.length > 0
      ? db
          .select()
          .from(mealPlanRecipes)
          .where(
            and(
              inArray(mealPlanRecipes.id, recipeIds),
              eq(mealPlanRecipes.userId, userId),
            ),
          )
      : Promise.resolve([]),
    scannedItemIds.length > 0
      ? db
          .select()
          .from(scannedItems)
          .where(
            and(
              inArray(scannedItems.id, scannedItemIds),
              eq(scannedItems.userId, userId),
              isNull(scannedItems.discardedAt),
            ),
          )
      : Promise.resolve([]),
  ]);

  for (const r of recipes) recipesMap.set(r.id, r);
  for (const s of scanned) scannedItemsMap.set(s.id, s);

  return items.map((item) => ({
    ...item,
    recipe: item.recipeId ? recipesMap.get(item.recipeId) || null : null,
    scannedItem: item.scannedItemId
      ? scannedItemsMap.get(item.scannedItemId) || null
      : null,
  }));
}

export async function getMealPlanItemById(
  id: number,
  userId: string,
): Promise<
  | (MealPlanItem & {
      recipe: MealPlanRecipe | null;
      scannedItem: ScannedItem | null;
    })
  | undefined
> {
  const [item] = await db
    .select()
    .from(mealPlanItems)
    .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)));
  if (!item) return undefined;

  const [recipe, scannedItem] = await Promise.all([
    item.recipeId
      ? db
          .select()
          .from(mealPlanRecipes)
          .where(eq(mealPlanRecipes.id, item.recipeId))
          .then(([r]) => r || null)
      : Promise.resolve(null),
    item.scannedItemId
      ? db
          .select()
          .from(scannedItems)
          .where(
            and(
              eq(scannedItems.id, item.scannedItemId),
              isNull(scannedItems.discardedAt),
            ),
          )
          .then(([s]) => s || null)
      : Promise.resolve(null),
  ]);

  return { ...item, recipe, scannedItem };
}

export async function addMealPlanItem(
  item: InsertMealPlanItem,
): Promise<MealPlanItem> {
  const [created] = await db.insert(mealPlanItems).values(item).returning();
  return created;
}

export async function removeMealPlanItem(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(mealPlanItems)
    .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)))
    .returning({ id: mealPlanItems.id });
  return result.length > 0;
}

export async function reorderMealPlanItems(
  userId: string,
  items: { id: number; sortOrder: number }[],
): Promise<void> {
  if (items.length === 0) return;

  // Build a single UPDATE with CASE expression instead of N round-trips
  const ids = items.map((i) => i.id);
  const caseFragments = items.map(
    (i) => sql`WHEN ${mealPlanItems.id} = ${i.id} THEN ${i.sortOrder}`,
  );

  await db
    .update(mealPlanItems)
    .set({
      sortOrder: sql`CASE ${sql.join(caseFragments, sql` `)} ELSE ${mealPlanItems.sortOrder} END`,
    })
    .where(
      and(eq(mealPlanItems.userId, userId), inArray(mealPlanItems.id, ids)),
    );
}

// ============================================================================
// MEAL CONFIRMATION HELPERS
// ============================================================================

export async function getConfirmedMealPlanItemIds(
  userId: string,
  date: Date,
): Promise<number[]> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const rows = await db
    .select({ mealPlanItemId: dailyLogs.mealPlanItemId })
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.userId, userId),
        eq(dailyLogs.source, "meal_plan_confirm"),
        gte(dailyLogs.loggedAt, startOfDay),
        lt(dailyLogs.loggedAt, endOfDay),
        sql`${dailyLogs.mealPlanItemId} IS NOT NULL`,
      ),
    );

  return rows.map((r) => r.mealPlanItemId!);
}

export async function getPlannedNutritionSummary(
  userId: string,
  date: Date,
  confirmedIds?: number[],
): Promise<{
  plannedCalories: number;
  plannedProtein: number;
  plannedCarbs: number;
  plannedFat: number;
  plannedItemCount: number;
}> {
  const dateStr = toDateString(date);

  // Exclude items already confirmed (logged) for this date
  // Use provided confirmedIds if available to avoid redundant DB query
  const excludeIds =
    confirmedIds ?? (await getConfirmedMealPlanItemIds(userId, date));

  const conditions = [
    eq(mealPlanItems.userId, userId),
    eq(mealPlanItems.plannedDate, dateStr),
  ];
  if (excludeIds.length > 0) {
    conditions.push(notInArray(mealPlanItems.id, excludeIds));
  }

  // LEFT JOIN both recipes and scanned items so nutrition from either source
  // is included. Soft-deleted scanned items are excluded via the join condition.
  const result = await db
    .select({
      plannedCalories: sql<number>`COALESCE(SUM(
        COALESCE(
          CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL),
          CAST(${scannedItems.calories} AS DECIMAL),
          0
        ) * CAST(${mealPlanItems.servings} AS DECIMAL)
      ), 0)`,
      plannedProtein: sql<number>`COALESCE(SUM(
        COALESCE(
          CAST(${mealPlanRecipes.proteinPerServing} AS DECIMAL),
          CAST(${scannedItems.protein} AS DECIMAL),
          0
        ) * CAST(${mealPlanItems.servings} AS DECIMAL)
      ), 0)`,
      plannedCarbs: sql<number>`COALESCE(SUM(
        COALESCE(
          CAST(${mealPlanRecipes.carbsPerServing} AS DECIMAL),
          CAST(${scannedItems.carbs} AS DECIMAL),
          0
        ) * CAST(${mealPlanItems.servings} AS DECIMAL)
      ), 0)`,
      plannedFat: sql<number>`COALESCE(SUM(
        COALESCE(
          CAST(${mealPlanRecipes.fatPerServing} AS DECIMAL),
          CAST(${scannedItems.fat} AS DECIMAL),
          0
        ) * CAST(${mealPlanItems.servings} AS DECIMAL)
      ), 0)`,
      plannedItemCount: sql<number>`COUNT(${mealPlanItems.id})`,
    })
    .from(mealPlanItems)
    .leftJoin(mealPlanRecipes, eq(mealPlanItems.recipeId, mealPlanRecipes.id))
    .leftJoin(
      scannedItems,
      and(
        eq(mealPlanItems.scannedItemId, scannedItems.id),
        isNull(scannedItems.discardedAt),
      ),
    )
    .where(and(...conditions));

  return (
    result[0] || {
      plannedCalories: 0,
      plannedProtein: 0,
      plannedCarbs: 0,
      plannedFat: 0,
      plannedItemCount: 0,
    }
  );
}

// ============================================================================
// FREQUENT RECIPES BY MEAL TYPE
// ============================================================================

export async function getFrequentRecipesForMealType(
  userId: string,
  mealType: string,
  limit = 8,
): Promise<MealPlanRecipe[]> {
  // Find the most-used recipeIds for a given mealType, then fetch the recipes.
  const frequentRows = await db
    .select({
      recipeId: mealPlanItems.recipeId,
      useCount: sql<number>`count(*)`.as("use_count"),
    })
    .from(mealPlanItems)
    .where(
      and(
        eq(mealPlanItems.userId, userId),
        eq(mealPlanItems.mealType, mealType),
        sql`${mealPlanItems.recipeId} IS NOT NULL`,
      ),
    )
    .groupBy(mealPlanItems.recipeId)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  const recipeIds = frequentRows
    .map((r) => r.recipeId)
    .filter((id): id is number => id !== null);

  if (recipeIds.length === 0) return [];

  const recipes = await db
    .select()
    .from(mealPlanRecipes)
    .where(inArray(mealPlanRecipes.id, recipeIds));

  // Preserve frequency order
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  return recipeIds
    .map((id) => recipeMap.get(id))
    .filter(Boolean) as MealPlanRecipe[];
}

// ============================================================================
// POPULAR PICKS (AI SUGGESTIONS PICKED BY OTHER USERS)
// ============================================================================

export async function getPopularPicksByMealType(
  userId: string,
  mealType: string,
  limit = 5,
): Promise<
  {
    title: string;
    description: string | null;
    calories: string | null;
    protein: string | null;
    carbs: string | null;
    fat: string | null;
    prepTimeMinutes: number | null;
    difficulty: string | null;
    dietTags: string[];
    pickCount: number;
  }[]
> {
  const rows = await db
    .select({
      title: mealPlanRecipes.title,
      description: mealPlanRecipes.description,
      calories: mealPlanRecipes.caloriesPerServing,
      protein: mealPlanRecipes.proteinPerServing,
      carbs: mealPlanRecipes.carbsPerServing,
      fat: mealPlanRecipes.fatPerServing,
      prepTimeMinutes: mealPlanRecipes.prepTimeMinutes,
      difficulty: mealPlanRecipes.difficulty,
      dietTags: mealPlanRecipes.dietTags,
      pickCount: sql<number>`count(distinct ${mealPlanRecipes.userId})`.as(
        "pick_count",
      ),
    })
    .from(mealPlanItems)
    .innerJoin(mealPlanRecipes, eq(mealPlanItems.recipeId, mealPlanRecipes.id))
    .where(
      and(
        eq(mealPlanItems.mealType, mealType),
        eq(mealPlanRecipes.sourceType, "ai_suggestion"),
        ne(mealPlanRecipes.userId, userId),
        // Limit scan window to recent items to prevent full table scan at scale
        gte(
          mealPlanItems.createdAt,
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        ),
      ),
    )
    .groupBy(
      mealPlanRecipes.title,
      mealPlanRecipes.description,
      mealPlanRecipes.caloriesPerServing,
      mealPlanRecipes.proteinPerServing,
      mealPlanRecipes.carbsPerServing,
      mealPlanRecipes.fatPerServing,
      mealPlanRecipes.prepTimeMinutes,
      mealPlanRecipes.difficulty,
      mealPlanRecipes.dietTags,
    )
    .orderBy(sql`count(distinct ${mealPlanRecipes.userId}) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    dietTags: (r.dietTags as string[] | null) ?? [],
    pickCount: Number(r.pickCount),
  }));
}

// ============================================================================
// AGGREGATION
// ============================================================================

export async function getMealPlanIngredientsForDateRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<RecipeIngredient[]> {
  // Get all recipe IDs from meal plan items in the date range
  const items = await db
    .select({ recipeId: mealPlanItems.recipeId })
    .from(mealPlanItems)
    .where(
      and(
        eq(mealPlanItems.userId, userId),
        gte(mealPlanItems.plannedDate, startDate),
        lte(mealPlanItems.plannedDate, endDate),
        sql`${mealPlanItems.recipeId} IS NOT NULL`,
      ),
    );

  const recipeIds = [
    ...new Set(items.filter((i) => i.recipeId).map((i) => i.recipeId!)),
  ];

  if (recipeIds.length === 0) return [];

  return db
    .select()
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, recipeIds));
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
  const allIngredients = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
    })
    .from(recipeIngredients)
    .where(sql`${recipeIngredients.recipeId} = ANY(${recipeIds})`);

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
