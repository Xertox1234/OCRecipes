import {
  type RecipeIngredient,
  type MealPlanRecipe,
  scannedItems,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
} from "@shared/schema";
import { toDateString } from "@shared/lib/date";
import { db } from "../db";
import {
  eq,
  and,
  gte,
  lte,
  ne,
  sql,
  inArray,
  notInArray,
  isNull,
} from "drizzle-orm";
import { getConfirmedMealPlanItemIds } from "./meal-plan-items";

// ============================================================================
// AGGREGATION
// ============================================================================

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
