import {
  type ScannedItem,
  type MealPlanRecipe,
  type InsertMealPlanItem,
  type MealPlanItem,
  type DailyLog,
  scannedItems,
  dailyLogs,
  mealPlanRecipes,
  mealPlanItems,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lte, lt, ne, sql, inArray, isNull } from "drizzle-orm";
import type { MealAudience } from "@shared/types/family";
import { getDayBounds } from "./helpers";
import { createDailyLog } from "./nutrition";

// ============================================================================
// MEAL PLAN ITEMS
// ============================================================================

/**
 * `includeProfileMeals` defaults to false: a meal planned for one family
 * profile is returned only to the caller that asks (the user's own plan screen,
 * and only while family planning is active).
 */
export async function getMealPlanItems(
  userId: string,
  startDate: string,
  endDate: string,
  opts: { includeProfileMeals?: boolean } = {},
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
        opts.includeProfileMeals
          ? undefined
          : ne(mealPlanItems.audience, "profile"),
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
 *
 * Never returns a meal planned for a family profile: every caller is AI-bound
 * (coach tool, coach brief, meal suggestions) and nothing about the family may
 * reach a provider. There is deliberately no opt-in.
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
        ne(mealPlanItems.audience, "profile"),
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
type Executor = Pick<typeof db, "insert" | "delete" | "select">;

/**
 * Returns undefined when `item.recipeId` is not the user's live (not
 * soft-deleted) recipe. The check runs in the write's own transaction under a
 * FOR SHARE lock, so a soft delete can't commit between check and insert — the
 * FK no longer refuses a soft-deleted recipe. A caller that passes its `tx`
 * gets the check and the insert in that transaction.
 */
export async function addMealPlanItem(
  item: InsertMealPlanItem,
  executor?: Executor,
): Promise<MealPlanItem | undefined> {
  const run = async (ex: Executor) => {
    if (item.recipeId != null) {
      const [live] = await ex
        .select({ id: mealPlanRecipes.id })
        .from(mealPlanRecipes)
        .where(
          and(
            eq(mealPlanRecipes.id, item.recipeId),
            eq(mealPlanRecipes.userId, item.userId),
            isNull(mealPlanRecipes.deletedAt),
          ),
        )
        .for("share");
      if (!live) return undefined;
    }
    const [created] = await ex.insert(mealPlanItems).values(item).returning();
    return created;
  };
  return executor ? run(executor) : db.transaction((tx) => run(tx));
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

/**
 * Sets who a planned meal is for; undefined when the item is not the user's,
 * "confirmed" when it would become a profile's meal but is already counted as
 * the user's intake.
 *
 * The item row is locked FOR UPDATE before the confirmed check, and
 * {@link createMealPlanConfirmLog} locks the same row FOR SHARE, so the two
 * serialize. Without the lock they interleave: a confirm's log insert takes
 * only FOR KEY SHARE (the foreign key), which an audience UPDATE does not
 * conflict with, and neither side sees the other's uncommitted write.
 */
export async function updateMealPlanItemAudience(
  id: number,
  userId: string,
  audience: MealAudience,
  familyProfileId: number | null,
): Promise<MealPlanItem | undefined | "confirmed"> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: mealPlanItems.id })
      .from(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)))
      .for("update");
    if (!item) return undefined;
    // A confirmed meal is already counted in the user's nutrition; it cannot
    // become someone else's.
    if (
      audience === "profile" &&
      (await isMealPlanItemConfirmed(id, userId, tx))
    ) {
      return "confirmed";
    }
    const [updated] = await tx
      .update(mealPlanItems)
      .set({ audience, familyProfileId })
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)))
      .returning();
    return updated;
  });
}

export type MealPlanConfirmResult =
  | { status: "not_found" }
  | { status: "profile" }
  | { status: "created"; log: DailyLog };

/**
 * Logs a planned meal as the user's intake. Refuses an item that is not the
 * user's ("not_found") or is planned for a family profile ("profile" — a
 * profile's meal is never the user's intake). The item row is locked FOR SHARE
 * so a concurrent change to a profile's meal ({@link updateMealPlanItemAudience})
 * either lands first and is seen here, or waits and sees this log.
 *
 * A second confirm of the same item is refused by the unique index
 * `daily_logs_unique_meal_plan_confirm`; its violation propagates to the caller.
 */
export async function createMealPlanConfirmLog(
  id: number,
  userId: string,
): Promise<MealPlanConfirmResult> {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)))
      .for("share");
    if (!item) return { status: "not_found" };
    if (item.audience === "profile") return { status: "profile" };
    const log = await createDailyLog(
      {
        userId,
        scannedItemId: item.scannedItemId || null,
        recipeId: item.recipeId || null,
        mealPlanItemId: item.id,
        source: "meal_plan_confirm",
        servings: item.servings || "1",
        mealType: item.mealType,
      },
      tx,
    );
    return { status: "created", log };
  });
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

/**
 * Whether the user has confirmed this meal-plan item (a `daily_logs` row
 * carries its id; see the unique index `daily_logs_unique_meal_plan_confirm`).
 */
export async function isMealPlanItemConfirmed(
  id: number,
  userId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: dailyLogs.id })
    .from(dailyLogs)
    .where(and(eq(dailyLogs.mealPlanItemId, id), eq(dailyLogs.userId, userId)))
    .limit(1);
  return row !== undefined;
}
