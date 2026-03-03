import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type * as schema from "@shared/schema";
import {
  scannedItems,
  dailyLogs,
  savedItems,
  favouriteScannedItems,
  mealPlanRecipes,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getScannedItems,
  getScannedItem,
  getScannedItemsByIds,
  getScannedItemWithFavourite,
  createScannedItem,
  softDeleteScannedItem,
  toggleFavouriteScannedItem,
  getDailyLogs,
  createDailyLog,
  getDailySummary,
  getDailyScanCount,
  getSavedItems,
  getSavedItemCount,
  createSavedItem,
  deleteSavedItem,
} = await import("../nutrition");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertScannedItem(
  userId: string,
  overrides: Partial<schema.InsertScannedItem> = {},
) {
  const t = getTestTx();
  const [item] = await t
    .insert(scannedItems)
    .values({
      userId,
      productName: "Test Food",
      barcode: "123456",
      calories: "200",
      protein: "10",
      carbs: "25",
      fat: "8",
      servingSize: "100g",
      sourceType: "test",
      ...overrides,
    })
    .returning();
  return item;
}

async function insertDailyLog(
  userId: string,
  overrides: Partial<schema.InsertDailyLog> = {},
) {
  const t = getTestTx();
  const [log] = await t
    .insert(dailyLogs)
    .values({
      userId,
      source: "scan",
      mealType: "lunch",
      ...overrides,
    })
    .returning();
  return log;
}

async function insertMealPlanRecipe(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const t = getTestTx();
  const [recipe] = await t
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Test Recipe",
      sourceType: "user_created",
      caloriesPerServing: "300",
      proteinPerServing: "20",
      carbsPerServing: "30",
      fatPerServing: "10",
      ...overrides,
    })
    .returning();
  return recipe;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("nutrition storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ==========================================================================
  // SCANNED ITEMS
  // ==========================================================================

  describe("createScannedItem", () => {
    it("creates and returns a scanned item with correct fields", async () => {
      const item = await createScannedItem({
        userId: testUser.id,
        productName: "Banana",
        barcode: "111222",
        calories: "105",
        protein: "1.3",
        carbs: "27",
        fat: "0.4",
        servingSize: "1 medium",
        sourceType: "barcode",
      });
      expect(item).toBeDefined();
      expect(item.id).toBeDefined();
      expect(item.productName).toBe("Banana");
      expect(item.barcode).toBe("111222");
      expect(item.calories).toBe("105.00");
      expect(item.userId).toBe(testUser.id);
      expect(item.scannedAt).toBeInstanceOf(Date);
      expect(item.discardedAt).toBeNull();
    });
  });

  describe("getScannedItem", () => {
    it("returns the item by id", async () => {
      const created = await insertScannedItem(testUser.id);
      const result = await getScannedItem(created.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(created.id);
      expect(result!.productName).toBe("Test Food");
    });

    it("returns undefined for non-existent id", async () => {
      const result = await getScannedItem(999999);
      expect(result).toBeUndefined();
    });

    it("excludes soft-deleted items", async () => {
      const created = await insertScannedItem(testUser.id);
      await softDeleteScannedItem(created.id, testUser.id);
      const result = await getScannedItem(created.id);
      expect(result).toBeUndefined();
    });
  });

  describe("getScannedItems", () => {
    it("returns items for user with pagination and total", async () => {
      await insertScannedItem(testUser.id, {
        productName: "Item A",
        scannedAt: new Date("2024-01-01T10:00:00Z"),
      });
      await insertScannedItem(testUser.id, {
        productName: "Item B",
        scannedAt: new Date("2024-01-01T11:00:00Z"),
      });
      await insertScannedItem(testUser.id, {
        productName: "Item C",
        scannedAt: new Date("2024-01-01T12:00:00Z"),
      });

      const { items, total } = await getScannedItems(testUser.id, 2, 0);
      expect(total).toBe(3);
      expect(items).toHaveLength(2);
      // Ordered by scannedAt desc, so newest first
      expect(items[0].productName).toBe("Item C");
      expect(items[1].productName).toBe("Item B");
    });

    it("returns isFavourited flag correctly", async () => {
      const item = await insertScannedItem(testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);

      const { items } = await getScannedItems(testUser.id);
      expect(items[0].isFavourited).toBe(true);
    });

    it("excludes soft-deleted items from results and total", async () => {
      const item1 = await insertScannedItem(testUser.id, {
        productName: "Keep",
      });
      const item2 = await insertScannedItem(testUser.id, {
        productName: "Delete",
      });
      await softDeleteScannedItem(item2.id, testUser.id);

      const { items, total } = await getScannedItems(testUser.id);
      expect(total).toBe(1);
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe(item1.id);
    });

    it("does not return another user's items", async () => {
      const otherUser = await createTestUser(tx, {
        username: `other_nutrition_user_${Date.now()}`,
      });
      await insertScannedItem(testUser.id, { productName: "Mine" });
      await insertScannedItem(otherUser.id, { productName: "Theirs" });

      const { items, total } = await getScannedItems(testUser.id);
      expect(total).toBe(1);
      expect(items[0].productName).toBe("Mine");
    });

    it("respects offset for pagination", async () => {
      await insertScannedItem(testUser.id, {
        productName: "First",
        scannedAt: new Date("2024-01-01T10:00:00Z"),
      });
      await insertScannedItem(testUser.id, {
        productName: "Second",
        scannedAt: new Date("2024-01-01T11:00:00Z"),
      });
      await insertScannedItem(testUser.id, {
        productName: "Third",
        scannedAt: new Date("2024-01-01T12:00:00Z"),
      });

      // Offset 2 with desc order: Third, Second, [First] ← offset skips first two
      const { items } = await getScannedItems(testUser.id, 2, 2);
      expect(items).toHaveLength(1);
      expect(items[0].productName).toBe("First");
    });
  });

  describe("getScannedItemsByIds", () => {
    it("returns items matching given ids", async () => {
      const item1 = await insertScannedItem(testUser.id, {
        productName: "A",
      });
      const item2 = await insertScannedItem(testUser.id, {
        productName: "B",
      });
      await insertScannedItem(testUser.id, { productName: "C" });

      const result = await getScannedItemsByIds([item1.id, item2.id]);
      expect(result).toHaveLength(2);
      const ids = result.map((r) => r.id);
      expect(ids).toContain(item1.id);
      expect(ids).toContain(item2.id);
    });

    it("returns empty array for empty ids input", async () => {
      const result = await getScannedItemsByIds([]);
      expect(result).toEqual([]);
    });

    it("excludes soft-deleted items", async () => {
      const item = await insertScannedItem(testUser.id);
      await softDeleteScannedItem(item.id, testUser.id);

      const result = await getScannedItemsByIds([item.id]);
      expect(result).toHaveLength(0);
    });

    it("filters by userId when provided", async () => {
      const otherUser = await createTestUser(tx, {
        username: `ids_other_user_${Date.now()}`,
      });
      const myItem = await insertScannedItem(testUser.id);
      const theirItem = await insertScannedItem(otherUser.id);

      const result = await getScannedItemsByIds(
        [myItem.id, theirItem.id],
        testUser.id,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(myItem.id);
    });
  });

  describe("getScannedItemWithFavourite", () => {
    it("returns item with isFavourited false when not favourited", async () => {
      const item = await insertScannedItem(testUser.id);
      const result = await getScannedItemWithFavourite(item.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(item.id);
      expect(result!.isFavourited).toBe(false);
    });

    it("returns item with isFavourited true when favourited", async () => {
      const item = await insertScannedItem(testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);

      const result = await getScannedItemWithFavourite(item.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.isFavourited).toBe(true);
    });

    it("returns undefined for soft-deleted item", async () => {
      const item = await insertScannedItem(testUser.id);
      await softDeleteScannedItem(item.id, testUser.id);

      const result = await getScannedItemWithFavourite(item.id, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns undefined for non-existent item", async () => {
      const result = await getScannedItemWithFavourite(999999, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  describe("softDeleteScannedItem", () => {
    it("soft-deletes and returns true for owned item", async () => {
      const item = await insertScannedItem(testUser.id);
      const result = await softDeleteScannedItem(item.id, testUser.id);
      expect(result).toBe(true);

      // Verify it's gone from normal queries
      const fetched = await getScannedItem(item.id);
      expect(fetched).toBeUndefined();
    });

    it("returns false for non-existent item", async () => {
      const result = await softDeleteScannedItem(999999, testUser.id);
      expect(result).toBe(false);
    });

    it("returns false for already soft-deleted item", async () => {
      const item = await insertScannedItem(testUser.id);
      await softDeleteScannedItem(item.id, testUser.id);
      const result = await softDeleteScannedItem(item.id, testUser.id);
      expect(result).toBe(false);
    });

    it("returns false when userId does not own item (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx, {
        username: `soft_del_other_${Date.now()}`,
      });
      const item = await insertScannedItem(otherUser.id);

      const result = await softDeleteScannedItem(item.id, testUser.id);
      expect(result).toBe(false);

      // Original item is still accessible
      const fetched = await getScannedItem(item.id);
      expect(fetched).toBeDefined();
    });

    it("deletes orphaned favourite rows in the same transaction", async () => {
      const item = await insertScannedItem(testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);

      // Verify the favourite row exists before soft-delete
      const t = getTestTx();
      const beforeRows = await t
        .select()
        .from(favouriteScannedItems)
        .where(eq(favouriteScannedItems.scannedItemId, item.id));
      expect(beforeRows).toHaveLength(1);

      await softDeleteScannedItem(item.id, testUser.id);

      // Favourite row should be physically deleted, not just hidden by JOINs
      const afterRows = await t
        .select()
        .from(favouriteScannedItems)
        .where(eq(favouriteScannedItems.scannedItemId, item.id));
      expect(afterRows).toHaveLength(0);
    });

    it("does not delete favourite rows when soft-delete fails (wrong user)", async () => {
      const otherUser = await createTestUser(tx, {
        username: `soft_del_fav_other_${Date.now()}`,
      });
      const item = await insertScannedItem(otherUser.id);
      await toggleFavouriteScannedItem(item.id, otherUser.id);

      // Attempt to soft-delete as wrong user
      const result = await softDeleteScannedItem(item.id, testUser.id);
      expect(result).toBe(false);

      // Favourite row should still exist
      const t = getTestTx();
      const rows = await t
        .select()
        .from(favouriteScannedItems)
        .where(eq(favouriteScannedItems.scannedItemId, item.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("toggleFavouriteScannedItem", () => {
    it("returns true when favouriting an item", async () => {
      const item = await insertScannedItem(testUser.id);
      const result = await toggleFavouriteScannedItem(item.id, testUser.id);
      expect(result).toBe(true);
    });

    it("returns false when un-favouriting an item", async () => {
      const item = await insertScannedItem(testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);
      const result = await toggleFavouriteScannedItem(item.id, testUser.id);
      expect(result).toBe(false);
    });

    it("can re-favourite after un-favouriting", async () => {
      const item = await insertScannedItem(testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);
      await toggleFavouriteScannedItem(item.id, testUser.id);
      const result = await toggleFavouriteScannedItem(item.id, testUser.id);
      expect(result).toBe(true);
    });

    it("returns null for non-existent item", async () => {
      const result = await toggleFavouriteScannedItem(999999, testUser.id);
      expect(result).toBeNull();
    });

    it("returns null for item owned by another user", async () => {
      const otherUser = await createTestUser(tx, {
        username: `fav_toggle_other_${Date.now()}`,
      });
      const item = await insertScannedItem(otherUser.id);
      const result = await toggleFavouriteScannedItem(item.id, testUser.id);
      expect(result).toBeNull();
    });

    it("returns null for soft-deleted item", async () => {
      const item = await insertScannedItem(testUser.id);
      await softDeleteScannedItem(item.id, testUser.id);
      const result = await toggleFavouriteScannedItem(item.id, testUser.id);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // DAILY LOGS
  // ==========================================================================

  describe("createDailyLog", () => {
    it("creates and returns a daily log with correct fields", async () => {
      const item = await insertScannedItem(testUser.id);
      const log = await createDailyLog({
        userId: testUser.id,
        scannedItemId: item.id,
        mealType: "breakfast",
        source: "scan",
        servings: "2",
      });
      expect(log).toBeDefined();
      expect(log.id).toBeDefined();
      expect(log.userId).toBe(testUser.id);
      expect(log.scannedItemId).toBe(item.id);
      expect(log.mealType).toBe("breakfast");
      expect(log.servings).toBe("2.00");
      expect(log.loggedAt).toBeInstanceOf(Date);
    });
  });

  describe("getDailyLogs", () => {
    it("returns logs for the given user and date", async () => {
      const today = new Date();
      const item = await insertScannedItem(testUser.id);
      await insertDailyLog(testUser.id, { scannedItemId: item.id });

      const logs = await getDailyLogs(testUser.id, today);
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe(testUser.id);
      expect(logs[0].scannedItemId).toBe(item.id);
    });

    it("does not return logs from a different date", async () => {
      const item = await insertScannedItem(testUser.id);
      await insertDailyLog(testUser.id, { scannedItemId: item.id });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const logs = await getDailyLogs(testUser.id, yesterday);
      expect(logs).toHaveLength(0);
    });

    it("does not return another user's logs", async () => {
      const otherUser = await createTestUser(tx, {
        username: `log_other_user_${Date.now()}`,
      });
      const item = await insertScannedItem(otherUser.id);
      await insertDailyLog(otherUser.id, { scannedItemId: item.id });

      const logs = await getDailyLogs(testUser.id, new Date());
      expect(logs).toHaveLength(0);
    });
  });

  describe("getDailySummary", () => {
    it("returns zeroes when no logs exist", async () => {
      const summary = await getDailySummary(testUser.id, new Date());
      expect(Number(summary.totalCalories)).toBe(0);
      expect(Number(summary.totalProtein)).toBe(0);
      expect(Number(summary.totalCarbs)).toBe(0);
      expect(Number(summary.totalFat)).toBe(0);
      expect(Number(summary.itemCount)).toBe(0);
    });

    it("aggregates scanned item nutrition via daily logs", async () => {
      const item = await insertScannedItem(testUser.id, {
        calories: "200",
        protein: "10",
        carbs: "25",
        fat: "8",
      });
      await insertDailyLog(testUser.id, {
        scannedItemId: item.id,
        servings: "1",
      });

      const summary = await getDailySummary(testUser.id, new Date());
      expect(Number(summary.totalCalories)).toBeCloseTo(200, 0);
      expect(Number(summary.totalProtein)).toBeCloseTo(10, 0);
      expect(Number(summary.totalCarbs)).toBeCloseTo(25, 0);
      expect(Number(summary.totalFat)).toBeCloseTo(8, 0);
      expect(Number(summary.itemCount)).toBe(1);
    });

    it("multiplies nutrition by servings", async () => {
      const item = await insertScannedItem(testUser.id, {
        calories: "100",
        protein: "5",
        carbs: "10",
        fat: "3",
      });
      await insertDailyLog(testUser.id, {
        scannedItemId: item.id,
        servings: "2.5",
      });

      const summary = await getDailySummary(testUser.id, new Date());
      expect(Number(summary.totalCalories)).toBeCloseTo(250, 0);
      expect(Number(summary.totalProtein)).toBeCloseTo(12.5, 0);
      expect(Number(summary.totalCarbs)).toBeCloseTo(25, 0);
      expect(Number(summary.totalFat)).toBeCloseTo(7.5, 0);
    });

    it("excludes discarded scanned items from totals", async () => {
      const item = await insertScannedItem(testUser.id, { calories: "300" });
      await insertDailyLog(testUser.id, { scannedItemId: item.id });
      await softDeleteScannedItem(item.id, testUser.id);

      const summary = await getDailySummary(testUser.id, new Date());
      expect(Number(summary.totalCalories)).toBe(0);
    });

    it("includes recipe-based logs in totals", async () => {
      const recipe = await insertMealPlanRecipe(testUser.id, {
        caloriesPerServing: "400",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "15",
      });
      await insertDailyLog(testUser.id, {
        recipeId: recipe.id,
        source: "meal_plan",
        servings: "1",
      });

      const summary = await getDailySummary(testUser.id, new Date());
      expect(Number(summary.totalCalories)).toBeCloseTo(400, 0);
      expect(Number(summary.totalProtein)).toBeCloseTo(30, 0);
      expect(Number(summary.itemCount)).toBe(1);
    });
  });

  describe("getDailyScanCount", () => {
    it("counts scanned items for the given user and date", async () => {
      await insertScannedItem(testUser.id);
      await insertScannedItem(testUser.id);

      const count = await getDailyScanCount(testUser.id, new Date());
      expect(count).toBe(2);
    });

    it("returns 0 when no scans exist for the date", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const count = await getDailyScanCount(testUser.id, yesterday);
      expect(count).toBe(0);
    });

    it("excludes soft-deleted items from count", async () => {
      await insertScannedItem(testUser.id);
      await insertScannedItem(testUser.id, {
        discardedAt: new Date(),
      });

      const count = await getDailyScanCount(testUser.id, new Date());
      expect(count).toBe(1);
    });

    it("does not count another user's scans", async () => {
      const otherUser = await createTestUser(tx, {
        username: `scan_count_other_${Date.now()}`,
      });
      await insertScannedItem(otherUser.id);

      const count = await getDailyScanCount(testUser.id, new Date());
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // SAVED ITEMS
  // ==========================================================================

  describe("getSavedItems", () => {
    it("returns saved items for user ordered by createdAt desc", async () => {
      const t = getTestTx();
      await t.insert(savedItems).values({
        userId: testUser.id,
        type: "recipe",
        title: "Older Recipe",
        createdAt: new Date("2024-01-01T10:00:00Z"),
      });
      await t.insert(savedItems).values({
        userId: testUser.id,
        type: "recipe",
        title: "Newer Recipe",
        createdAt: new Date("2024-01-01T12:00:00Z"),
      });

      const items = await getSavedItems(testUser.id);
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe("Newer Recipe");
      expect(items[1].title).toBe("Older Recipe");
    });

    it("does not return another user's saved items", async () => {
      const otherUser = await createTestUser(tx, {
        username: `saved_other_user_${Date.now()}`,
      });
      await tx.insert(savedItems).values({
        userId: otherUser.id,
        type: "recipe",
        title: "Their Recipe",
      });

      const items = await getSavedItems(testUser.id);
      expect(items).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      const t = getTestTx();
      for (let i = 0; i < 5; i++) {
        await t.insert(savedItems).values({
          userId: testUser.id,
          type: "recipe",
          title: `Recipe ${i}`,
        });
      }

      const items = await getSavedItems(testUser.id, 3);
      expect(items).toHaveLength(3);
    });
  });

  describe("getSavedItemCount", () => {
    it("returns 0 when user has no saved items", async () => {
      const count = await getSavedItemCount(testUser.id);
      expect(count).toBe(0);
    });

    it("returns correct count for user", async () => {
      const t = getTestTx();
      await t.insert(savedItems).values({
        userId: testUser.id,
        type: "recipe",
        title: "A",
      });
      await t.insert(savedItems).values({
        userId: testUser.id,
        type: "activity",
        title: "B",
      });

      const count = await getSavedItemCount(testUser.id);
      expect(count).toBe(2);
    });

    it("does not count another user's items", async () => {
      const otherUser = await createTestUser(tx, {
        username: `count_other_user_${Date.now()}`,
      });
      await tx.insert(savedItems).values({
        userId: otherUser.id,
        type: "recipe",
        title: "Their Item",
      });

      const count = await getSavedItemCount(testUser.id);
      expect(count).toBe(0);
    });
  });

  describe("createSavedItem", () => {
    it("creates and returns a saved item when under limit", async () => {
      const item = await createSavedItem(testUser.id, {
        type: "recipe",
        title: "New Recipe",
        description: "A test recipe",
      });
      expect(item).not.toBeNull();
      expect(item!.title).toBe("New Recipe");
      expect(item!.description).toBe("A test recipe");
      expect(item!.userId).toBe(testUser.id);
      expect(item!.type).toBe("recipe");
    });

    it("returns null when at free tier limit", async () => {
      const t = getTestTx();
      // Free tier maxSavedItems is 6
      for (let i = 0; i < 6; i++) {
        await t.insert(savedItems).values({
          userId: testUser.id,
          type: "recipe",
          title: `Existing ${i}`,
        });
      }

      const result = await createSavedItem(testUser.id, {
        type: "recipe",
        title: "One Too Many",
      });
      expect(result).toBeNull();
    });

    it("allows creation up to the limit", async () => {
      const t = getTestTx();
      // Insert 5 items (one below free limit of 6)
      for (let i = 0; i < 5; i++) {
        await t.insert(savedItems).values({
          userId: testUser.id,
          type: "recipe",
          title: `Existing ${i}`,
        });
      }

      const item = await createSavedItem(testUser.id, {
        type: "recipe",
        title: "Sixth Item",
      });
      expect(item).not.toBeNull();
      expect(item!.title).toBe("Sixth Item");
    });
  });

  describe("deleteSavedItem", () => {
    it("deletes and returns true for owned item", async () => {
      const [item] = await tx
        .insert(savedItems)
        .values({
          userId: testUser.id,
          type: "recipe",
          title: "To Delete",
        })
        .returning();

      const result = await deleteSavedItem(item.id, testUser.id);
      expect(result).toBe(true);

      // Verify it's gone
      const items = await getSavedItems(testUser.id);
      expect(items).toHaveLength(0);
    });

    it("returns false for non-existent item", async () => {
      const result = await deleteSavedItem(999999, testUser.id);
      expect(result).toBe(false);
    });

    it("returns false when userId does not own item (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx, {
        username: `del_saved_other_${Date.now()}`,
      });
      const [item] = await tx
        .insert(savedItems)
        .values({
          userId: otherUser.id,
          type: "recipe",
          title: "Not Yours",
        })
        .returning();

      const result = await deleteSavedItem(item.id, testUser.id);
      expect(result).toBe(false);

      // Original item still exists
      const items = await getSavedItems(otherUser.id);
      expect(items).toHaveLength(1);
    });
  });
});
