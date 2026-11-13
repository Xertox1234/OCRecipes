import {
  type ScannedItem,
  type MealPlanRecipe,
  type InsertMealPlanItem,
  type MealPlanItem,
  scannedItems,
  dailyLogs,
  mealPlanRecipes,
  mealPlanItems,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lte, lt, sql, inArray, isNull } from "drizzle-orm";
import { getDayBounds } from "./helpers";

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
              isNull(mealPlanRecipes.deletedAt),
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

/** Recipe columns the coach brief, `get_meal_plan` tool and suggestions read. */
export type MealPlanRecipeSummary = Pick<
  MealPlanRecipe,
  | "id"
  | "title"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
>;

/** Scanned-item columns the same callers read. */
export type ScannedItemSummary = Pick<
  ScannedItem,
  "id" | "productName" | "calories" | "protein" | "carbs" | "fat"
>;

/**
 * Narrow variant of {@link getMealPlanItems}: the same user / date / soft-delete
 * filters, but the joined recipe and scanned item carry only the nutrition
 * summary columns (no `instructions`, `ingredients`, image URLs, ...). For
 * server-side callers that never forward the full rows.
 */
export async function getMealPlanItemSummaries(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<
  (MealPlanItem & {
    recipe: MealPlanRecipeSummary | null;
    scannedItem: ScannedItemSummary | null;
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

  const recipeIds = [
    ...new Set(items.filter((i) => i.recipeId).map((i) => i.recipeId!)),
  ];
  const scannedItemIds = [
    ...new Set(
      items.filter((i) => i.scannedItemId).map((i) => i.scannedItemId!),
    ),
  ];

  const [recipes, scanned] = await Promise.all([
    recipeIds.length > 0
      ? db
          .select({
            id: mealPlanRecipes.id,
            title: mealPlanRecipes.title,
            caloriesPerServing: mealPlanRecipes.caloriesPerServing,
            proteinPerServing: mealPlanRecipes.proteinPerServing,
            carbsPerServing: mealPlanRecipes.carbsPerServing,
            fatPerServing: mealPlanRecipes.fatPerServing,
          })
          .from(mealPlanRecipes)
          .where(
            and(
              inArray(mealPlanRecipes.id, recipeIds),
              eq(mealPlanRecipes.userId, userId),
              isNull(mealPlanRecipes.deletedAt),
            ),
          )
      : Promise.resolve([] as MealPlanRecipeSummary[]),
    scannedItemIds.length > 0
      ? db
          .select({
            id: scannedItems.id,
            productName: scannedItems.productName,
            calories: scannedItems.calories,
            protein: scannedItems.protein,
            carbs: scannedItems.carbs,
            fat: scannedItems.fat,
          })
          .from(scannedItems)
          .where(
            and(
              inArray(scannedItems.id, scannedItemIds),
              eq(scannedItems.userId, userId),
              isNull(scannedItems.discardedAt),
            ),
          )
      : Promise.resolve([] as ScannedItemSummary[]),
  ]);

  const recipesMap = new Map(recipes.map((r) => [r.id, r]));
  const scannedItemsMap = new Map(scanned.map((s) => [s.id, s]));

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
          .where(
            and(
              eq(mealPlanRecipes.id, item.recipeId),
              isNull(mealPlanRecipes.deletedAt),
            ),
          )
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

/** A caller inside a transaction (a Coach write-card save/undo) passes its `tx`. */
type Executor = Pick<typeof db, "insert" | "delete">;

export async function addMealPlanItem(
  item: InsertMealPlanItem,
  executor: Executor = db,
): Promise<MealPlanItem> {
  const [created] = await executor
    .insert(mealPlanItems)
    .values(item)
    .returning();
  return created;
}

export async function removeMealPlanItem(
  id: number,
  userId: string,
  executor: Executor = db,
): Promise<boolean> {
  const result = await executor
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

/**
 * IDs of meal-plan items already confirmed (logged) on a given day.
 *
 * `tz` is REQUIRED, deliberately. `getDayBounds` defaults it to UTC, and this
 * function is called on the same response as `getDailySummary`, which is
 * tz-aware — so a UTC default here silently bucketed the two halves of one
 * answer on different days, and a meal logged near a day edge could be counted
 * as both consumed and still-planned while rendering as unconfirmed. An
 * optional parameter with a plausible default is what allowed that; making the
 * caller state the timezone is the fix.
 *
 * `date` is an INSTANT — the bounds are those of whatever civil day it falls in
 * for `tz`. Callers holding a `yyyy-mm-dd` must convert with
 * `civilDateToInstant(dateStr, tz)`, never `new Date(dateStr)`.
 */
export async function getConfirmedMealPlanItemIds(
  userId: string,
  date: Date,
  tz: string,
): Promise<number[]> {
  const { startOfDay, endOfDay } = getDayBounds(date, tz);

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
