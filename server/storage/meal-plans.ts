import {
  type ScannedItem,
  type MealPlanRecipe,
  type InsertMealPlanRecipe,
  type RecipeIngredient,
  type InsertRecipeIngredient,
  type MealPlanItem,
  type InsertMealPlanItem,
  type GroceryList,
  type InsertGroceryList,
  type GroceryListItem,
  type InsertGroceryListItem,
  type PantryItem,
  type InsertPantryItem,
  type CommunityRecipe,
  scannedItems,
  dailyLogs,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  groceryLists,
  groceryListItems,
  pantryItems,
  communityRecipes,
} from "@shared/schema";
import { db } from "../db";
import {
  eq,
  desc,
  and,
  gte,
  lte,
  lt,
  sql,
  or,
  ilike,
  isNull,
  inArray,
  notInArray,
} from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";

// ============================================================================
// MEAL PLAN RECIPES
// ============================================================================

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
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(eq(mealPlanRecipes.id, id));
  return recipe || undefined;
}

export async function getMealPlanRecipeWithIngredients(
  id: number,
): Promise<(MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined> {
  const [recipe, ingredients] = await Promise.all([
    getMealPlanRecipe(id),
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
  if (ingredients && ingredients.length > 0) {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mealPlanRecipes)
        .values(recipe)
        .returning();
      await tx.insert(recipeIngredients).values(
        ingredients.map((ing, idx) => ({
          ...ing,
          recipeId: created.id,
          displayOrder: ing.displayOrder ?? idx,
        })),
      );
      return created;
    });
  }

  const [created] = await db.insert(mealPlanRecipes).values(recipe).returning();
  return created;
}

export async function updateMealPlanRecipe(
  id: number,
  userId: string,
  updates: Partial<InsertMealPlanRecipe>,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .update(mealPlanRecipes)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)))
    .returning();
  return recipe || undefined;
}

export async function deleteMealPlanRecipe(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(mealPlanRecipes)
    .where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)))
    .returning({ id: mealPlanRecipes.id });
  return result.length > 0;
}

export async function getUnifiedRecipes(params: {
  userId: string;
  query?: string;
  cuisine?: string;
  diet?: string;
  limit?: number;
}): Promise<{ community: CommunityRecipe[]; personal: MealPlanRecipe[] }> {
  const { userId, query, cuisine, diet } = params;
  // Limit is applied independently to each source, so the total result
  // set may contain up to 2x this value (community + personal).
  const resultLimit = Math.min(params.limit ?? 50, 100);

  const communityConditions = [eq(communityRecipes.isPublic, true)];
  const personalConditions = [eq(mealPlanRecipes.userId, userId)];

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

  const [community, personal] = await Promise.all([
    db
      .select()
      .from(communityRecipes)
      .where(and(...communityConditions))
      .orderBy(desc(communityRecipes.createdAt))
      .limit(resultLimit),
    db
      .select()
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

  if (recipeIds.length > 0) {
    const recipes = await db
      .select()
      .from(mealPlanRecipes)
      .where(inArray(mealPlanRecipes.id, recipeIds));
    for (const r of recipes) recipesMap.set(r.id, r);
  }

  if (scannedItemIds.length > 0) {
    const scanned = await db
      .select()
      .from(scannedItems)
      .where(
        and(
          inArray(scannedItems.id, scannedItemIds),
          isNull(scannedItems.discardedAt),
        ),
      );
    for (const s of scanned) scannedItemsMap.set(s.id, s);
  }

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
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(mealPlanItems)
        .set({ sortOrder: item.sortOrder })
        .where(
          and(eq(mealPlanItems.id, item.id), eq(mealPlanItems.userId, userId)),
        );
    }
  });
}

// ============================================================================
// GROCERY LISTS
// ============================================================================

export async function createGroceryList(
  list: InsertGroceryList,
): Promise<GroceryList> {
  const [created] = await db.insert(groceryLists).values(list).returning();
  return created;
}

export async function getGroceryLists(
  userId: string,
  limit = 100,
): Promise<GroceryList[]> {
  return db
    .select()
    .from(groceryLists)
    .where(eq(groceryLists.userId, userId))
    .orderBy(desc(groceryLists.createdAt))
    .limit(limit);
}

export async function getGroceryListWithItems(
  id: number,
  userId: string,
): Promise<(GroceryList & { items: GroceryListItem[] }) | undefined> {
  const [list] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)));
  if (!list) return undefined;

  const items = await db
    .select()
    .from(groceryListItems)
    .where(eq(groceryListItems.groceryListId, id))
    .orderBy(groceryListItems.category, groceryListItems.name);

  return { ...list, items };
}

export async function deleteGroceryList(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)))
    .returning({ id: groceryLists.id });
  return result.length > 0;
}

export async function addGroceryListItem(
  item: InsertGroceryListItem,
): Promise<GroceryListItem> {
  const [created] = await db.insert(groceryListItems).values(item).returning();
  return created;
}

export async function addGroceryListItems(
  items: InsertGroceryListItem[],
): Promise<GroceryListItem[]> {
  if (items.length === 0) return [];
  return db.insert(groceryListItems).values(items).returning();
}

export async function updateGroceryListItemChecked(
  id: number,
  groceryListId: number,
  isChecked: boolean,
): Promise<GroceryListItem | undefined> {
  const [updated] = await db
    .update(groceryListItems)
    .set({
      isChecked,
      checkedAt: isChecked ? new Date() : null,
    })
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning();
  return updated || undefined;
}

export async function deleteGroceryListItem(
  id: number,
  groceryListId: number,
): Promise<boolean> {
  const result = await db
    .delete(groceryListItems)
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning({ id: groceryListItems.id });
  return result.length > 0;
}

export async function updateGroceryListItemPantryFlag(
  id: number,
  groceryListId: number,
  addedToPantry: boolean,
): Promise<GroceryListItem | undefined> {
  const [updated] = await db
    .update(groceryListItems)
    .set({ addedToPantry })
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning();
  return updated || undefined;
}

// ============================================================================
// PANTRY ITEMS
// ============================================================================

export async function getPantryItems(
  userId: string,
  limit = 200,
): Promise<PantryItem[]> {
  return db
    .select()
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId))
    .orderBy(pantryItems.category, pantryItems.name)
    .limit(limit);
}

export async function getPantryItem(
  id: number,
  userId: string,
): Promise<PantryItem | undefined> {
  const [item] = await db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)));
  return item || undefined;
}

export async function createPantryItem(
  item: InsertPantryItem,
): Promise<PantryItem> {
  const [created] = await db.insert(pantryItems).values(item).returning();
  return created;
}

export async function updatePantryItem(
  id: number,
  userId: string,
  updates: Partial<InsertPantryItem>,
): Promise<PantryItem | undefined> {
  const [updated] = await db
    .update(pantryItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
    .returning();
  return updated || undefined;
}

export async function deletePantryItem(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(pantryItems)
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
    .returning({ id: pantryItems.id });
  return result.length > 0;
}

export async function getExpiringPantryItems(
  userId: string,
  withinDays: number,
): Promise<PantryItem[]> {
  const now = new Date();
  const deadline = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  return db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.userId, userId),
        sql`${pantryItems.expiresAt} IS NOT NULL`,
        lte(pantryItems.expiresAt, deadline),
        gte(pantryItems.expiresAt, now),
      ),
    )
    .orderBy(pantryItems.expiresAt);
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
  const dateStr = date.toISOString().split("T")[0];

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
