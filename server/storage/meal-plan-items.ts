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
