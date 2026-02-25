import {
  type ScannedItem,
  type InsertScannedItem,
  type DailyLog,
  type InsertDailyLog,
  type SavedItem,
  scannedItems,
  dailyLogs,
  savedItems,
  favouriteScannedItems,
  mealPlanRecipes,
} from "@shared/schema";
import { type CreateSavedItemInput } from "@shared/schemas/saved-items";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql, isNull, inArray } from "drizzle-orm";
import { getDayBounds } from "./helpers";
import { getSubscriptionStatus } from "./users";

// ============================================================================
// SCANNED ITEMS
// ============================================================================

export async function getScannedItems(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{
  items: (ScannedItem & { isFavourited: boolean })[];
  total: number;
}> {
  const activeFilter = and(
    eq(scannedItems.userId, userId),
    isNull(scannedItems.discardedAt),
  );

  const [rows, countResult] = await Promise.all([
    db
      .select({
        item: scannedItems,
        favouriteId: favouriteScannedItems.id,
      })
      .from(scannedItems)
      .leftJoin(
        favouriteScannedItems,
        and(
          eq(favouriteScannedItems.scannedItemId, scannedItems.id),
          eq(favouriteScannedItems.userId, userId),
        ),
      )
      .where(activeFilter)
      .orderBy(desc(scannedItems.scannedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(scannedItems)
      .where(activeFilter),
  ]);

  const items = rows.map((row) => ({
    ...row.item,
    isFavourited: row.favouriteId !== null,
  }));

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function getScannedItem(
  id: number,
): Promise<ScannedItem | undefined> {
  const [item] = await db
    .select()
    .from(scannedItems)
    .where(and(eq(scannedItems.id, id), isNull(scannedItems.discardedAt)));
  return item || undefined;
}

export async function getScannedItemsByIds(
  ids: number[],
  userId?: string,
): Promise<ScannedItem[]> {
  if (ids.length === 0) return [];
  const conditions = [
    inArray(scannedItems.id, ids),
    isNull(scannedItems.discardedAt),
  ];
  if (userId) conditions.push(eq(scannedItems.userId, userId));
  return db
    .select()
    .from(scannedItems)
    .where(and(...conditions));
}

export async function getScannedItemWithFavourite(
  id: number,
  userId: string,
): Promise<(ScannedItem & { isFavourited: boolean }) | undefined> {
  const [row] = await db
    .select({
      item: scannedItems,
      favouriteId: favouriteScannedItems.id,
    })
    .from(scannedItems)
    .leftJoin(
      favouriteScannedItems,
      and(
        eq(favouriteScannedItems.scannedItemId, scannedItems.id),
        eq(favouriteScannedItems.userId, userId),
      ),
    )
    .where(and(eq(scannedItems.id, id), isNull(scannedItems.discardedAt)));

  if (!row) return undefined;
  return { ...row.item, isFavourited: row.favouriteId !== null };
}

export async function createScannedItem(
  item: InsertScannedItem,
): Promise<ScannedItem> {
  const [scannedItem] = await db.insert(scannedItems).values(item).returning();
  return scannedItem;
}

export async function softDeleteScannedItem(
  id: number,
  userId: string,
): Promise<boolean> {
  const [updated] = await db
    .update(scannedItems)
    .set({ discardedAt: new Date() })
    .where(
      and(
        eq(scannedItems.id, id),
        eq(scannedItems.userId, userId),
        isNull(scannedItems.discardedAt),
      ),
    )
    .returning({ id: scannedItems.id });
  return !!updated;
}

export async function toggleFavouriteScannedItem(
  scannedItemId: number,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(favouriteScannedItems)
      .where(
        and(
          eq(favouriteScannedItems.scannedItemId, scannedItemId),
          eq(favouriteScannedItems.userId, userId),
        ),
      );

    if (existing) {
      await tx
        .delete(favouriteScannedItems)
        .where(eq(favouriteScannedItems.id, existing.id));
      return false; // un-favourited
    }

    await tx.insert(favouriteScannedItems).values({ userId, scannedItemId });
    return true; // favourited
  });
}

export async function getFavouriteScannedItems(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{
  items: (ScannedItem & { isFavourited: boolean })[];
  total: number;
}> {
  const [rows, countResult] = await Promise.all([
    db
      .select({
        item: scannedItems,
        favouriteId: favouriteScannedItems.id,
      })
      .from(favouriteScannedItems)
      .innerJoin(
        scannedItems,
        eq(favouriteScannedItems.scannedItemId, scannedItems.id),
      )
      .where(
        and(
          eq(favouriteScannedItems.userId, userId),
          isNull(scannedItems.discardedAt),
        ),
      )
      .orderBy(desc(favouriteScannedItems.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(favouriteScannedItems)
      .innerJoin(
        scannedItems,
        eq(favouriteScannedItems.scannedItemId, scannedItems.id),
      )
      .where(
        and(
          eq(favouriteScannedItems.userId, userId),
          isNull(scannedItems.discardedAt),
        ),
      ),
  ]);

  const items = rows.map((row) => ({
    ...row.item,
    isFavourited: true,
  }));

  return { items, total: Number(countResult[0]?.count ?? 0) };
}

// ============================================================================
// DAILY LOGS
// ============================================================================

export async function getDailyLogs(
  userId: string,
  date: Date,
): Promise<DailyLog[]> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  return db
    .select()
    .from(dailyLogs)
    .where(
      and(
        eq(dailyLogs.userId, userId),
        gte(dailyLogs.loggedAt, startOfDay),
        lt(dailyLogs.loggedAt, endOfDay),
      ),
    )
    .orderBy(desc(dailyLogs.loggedAt));
}

export async function createDailyLog(log: InsertDailyLog): Promise<DailyLog> {
  const [dailyLog] = await db.insert(dailyLogs).values(log).returning();
  return dailyLog;
}

export async function getDailySummary(
  userId: string,
  date: Date,
): Promise<{
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
}> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({
      totalCalories: sql<number>`COALESCE(SUM(
        COALESCE(CAST(${scannedItems.calories} AS DECIMAL), CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
        * CAST(${dailyLogs.servings} AS DECIMAL)
      ), 0)`,
      totalProtein: sql<number>`COALESCE(SUM(
        COALESCE(CAST(${scannedItems.protein} AS DECIMAL), CAST(${mealPlanRecipes.proteinPerServing} AS DECIMAL), 0)
        * CAST(${dailyLogs.servings} AS DECIMAL)
      ), 0)`,
      totalCarbs: sql<number>`COALESCE(SUM(
        COALESCE(CAST(${scannedItems.carbs} AS DECIMAL), CAST(${mealPlanRecipes.carbsPerServing} AS DECIMAL), 0)
        * CAST(${dailyLogs.servings} AS DECIMAL)
      ), 0)`,
      totalFat: sql<number>`COALESCE(SUM(
        COALESCE(CAST(${scannedItems.fat} AS DECIMAL), CAST(${mealPlanRecipes.fatPerServing} AS DECIMAL), 0)
        * CAST(${dailyLogs.servings} AS DECIMAL)
      ), 0)`,
      itemCount: sql<number>`COUNT(${dailyLogs.id})`,
    })
    .from(dailyLogs)
    .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
    .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id))
    .where(
      and(
        eq(dailyLogs.userId, userId),
        gte(dailyLogs.loggedAt, startOfDay),
        lt(dailyLogs.loggedAt, endOfDay),
        // Exclude discarded scanned items from daily totals
        sql`(${scannedItems.discardedAt} IS NULL OR ${dailyLogs.scannedItemId} IS NULL)`,
      ),
    );

  return (
    result[0] || {
      totalCalories: 0,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      itemCount: 0,
    }
  );
}

export async function getDailyScanCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(scannedItems)
    .where(
      and(
        eq(scannedItems.userId, userId),
        gte(scannedItems.scannedAt, startOfDay),
        lt(scannedItems.scannedAt, endOfDay),
      ),
    );

  return Number(result[0]?.count ?? 0);
}

// ============================================================================
// SAVED ITEMS
// ============================================================================

export async function getSavedItems(userId: string): Promise<SavedItem[]> {
  return db
    .select()
    .from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt));
}

export async function getSavedItemCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(savedItems)
    .where(eq(savedItems.userId, userId));
  return result[0]?.count ?? 0;
}

export async function createSavedItem(
  userId: string,
  itemData: CreateSavedItemInput,
): Promise<SavedItem | null> {
  const count = await getSavedItemCount(userId);
  const subscription = await getSubscriptionStatus(userId);
  const tierValue = subscription?.tier || "free";
  const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
  const limit = TIER_FEATURES[tier].maxSavedItems;

  if (count >= limit) {
    return null; // Signal limit reached
  }

  const [item] = await db
    .insert(savedItems)
    .values({ ...itemData, userId })
    .returning();

  return item;
}

export async function deleteSavedItem(
  id: number,
  userId: string,
): Promise<boolean> {
  // IDOR protection: only delete if owned by user
  const result = await db
    .delete(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId)))
    .returning({ id: savedItems.id });

  return result.length > 0;
}
