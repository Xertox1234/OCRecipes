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
import type * as schema from "@shared/schema";
import { mealPlanRecipes, dailyLogs, scannedItems } from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getMealPlanItems,
  getMealPlanItemById,
  addMealPlanItem,
  removeMealPlanItem,
  reorderMealPlanItems,
  getConfirmedMealPlanItemIds,
} = await import("../meal-plan-items");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
let testRecipe: schema.MealPlanRecipe;

/** Insert a minimal meal plan recipe for use in items. */
async function createTestMealPlanRecipe(
  userId: string,
): Promise<schema.MealPlanRecipe> {
  const [recipe] = await tx
    .insert(mealPlanRecipes)
    .values({ userId, title: "Test Recipe", instructions: ["Step 1"] })
    .returning();
  return recipe;
}

describe("meal-plan-items storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    testRecipe = await createTestMealPlanRecipe(testUser.id);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // --------------------------------------------------------------------------
  // addMealPlanItem
  // --------------------------------------------------------------------------
  describe("addMealPlanItem", () => {
    it("creates a meal plan item and returns it", async () => {
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-01",
        mealType: "dinner",
        servings: "2",
      });

      expect(item.id).toBeDefined();
      expect(item.userId).toBe(testUser.id);
      expect(item.recipeId).toBe(testRecipe.id);
      expect(item.plannedDate).toBe("2025-06-01");
      expect(item.mealType).toBe("dinner");
    });

    it("creates a scanned-item plan item", async () => {
      const [scanned] = await tx
        .insert(scannedItems)
        .values({
          userId: testUser.id,
          productName: "Protein Bar",
          calories: "200",
          protein: "20",
          carbs: "15",
          fat: "5",
          sourceType: "scan",
        })
        .returning();

      const item = await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-01",
        mealType: "snack",
        servings: "1",
      });

      expect(item.scannedItemId).toBe(scanned.id);
    });
  });

  // --------------------------------------------------------------------------
  // getMealPlanItems
  // --------------------------------------------------------------------------
  describe("getMealPlanItems", () => {
    it("returns empty array when no items exist for the date range", async () => {
      const result = await getMealPlanItems(
        testUser.id,
        "2020-01-01",
        "2020-01-07",
      );
      expect(result).toHaveLength(0);
    });

    it("returns items with associated recipe in the date range", async () => {
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-03",
        mealType: "lunch",
        servings: "1",
      });

      const result = await getMealPlanItems(
        testUser.id,
        "2025-06-01",
        "2025-06-07",
      );
      expect(result).toHaveLength(1);
      expect(result[0].recipe).not.toBeNull();
      expect(result[0].recipe!.id).toBe(testRecipe.id);
    });

    it("excludes items outside the date range", async () => {
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-07-01",
        mealType: "breakfast",
        servings: "1",
      });

      const result = await getMealPlanItems(
        testUser.id,
        "2025-06-01",
        "2025-06-30",
      );
      expect(result).toHaveLength(0);
    });

    it("only returns items for the requesting user", async () => {
      const otherUser = await createTestUser(tx);
      const otherRecipe = await createTestMealPlanRecipe(otherUser.id);
      await addMealPlanItem({
        userId: otherUser.id,
        recipeId: otherRecipe.id,
        plannedDate: "2025-06-03",
        mealType: "dinner",
        servings: "1",
      });

      const result = await getMealPlanItems(
        testUser.id,
        "2025-06-01",
        "2025-06-07",
      );
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getMealPlanItemById
  // --------------------------------------------------------------------------
  describe("getMealPlanItemById", () => {
    it("returns undefined for nonexistent item", async () => {
      const result = await getMealPlanItemById(999999, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns the item with recipe for existing id and owner", async () => {
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-05",
        mealType: "dinner",
        servings: "2",
      });

      const result = await getMealPlanItemById(item.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(item.id);
      expect(result!.recipe).not.toBeNull();
    });

    it("returns undefined for an item owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const otherRecipe = await createTestMealPlanRecipe(otherUser.id);
      const item = await addMealPlanItem({
        userId: otherUser.id,
        recipeId: otherRecipe.id,
        plannedDate: "2025-06-05",
        mealType: "dinner",
        servings: "1",
      });

      const result = await getMealPlanItemById(item.id, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // removeMealPlanItem
  // --------------------------------------------------------------------------
  describe("removeMealPlanItem", () => {
    it("removes an item and returns true", async () => {
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-08",
        mealType: "lunch",
        servings: "1",
      });

      const result = await removeMealPlanItem(item.id, testUser.id);
      expect(result).toBe(true);

      const check = await getMealPlanItemById(item.id, testUser.id);
      expect(check).toBeUndefined();
    });

    it("returns false for an item not owned by user", async () => {
      const otherUser = await createTestUser(tx);
      const otherRecipe = await createTestMealPlanRecipe(otherUser.id);
      const item = await addMealPlanItem({
        userId: otherUser.id,
        recipeId: otherRecipe.id,
        plannedDate: "2025-06-08",
        mealType: "lunch",
        servings: "1",
      });

      const result = await removeMealPlanItem(item.id, testUser.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // reorderMealPlanItems
  // --------------------------------------------------------------------------
  describe("reorderMealPlanItems", () => {
    it("does not throw when items array is empty", async () => {
      await expect(
        reorderMealPlanItems(testUser.id, []),
      ).resolves.not.toThrow();
    });

    it("updates sort order for the given items", async () => {
      const item1 = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-10",
        mealType: "breakfast",
        servings: "1",
        sortOrder: 1,
      });
      const item2 = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: "2025-06-10",
        mealType: "lunch",
        servings: "1",
        sortOrder: 2,
      });

      await reorderMealPlanItems(testUser.id, [
        { id: item1.id, sortOrder: 10 },
        { id: item2.id, sortOrder: 5 },
      ]);

      const updated1 = await getMealPlanItemById(item1.id, testUser.id);
      const updated2 = await getMealPlanItemById(item2.id, testUser.id);
      expect(updated1!.sortOrder).toBe(10);
      expect(updated2!.sortOrder).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // getConfirmedMealPlanItemIds
  // --------------------------------------------------------------------------
  describe("getConfirmedMealPlanItemIds", () => {
    it("returns empty array when no confirmations exist for today", async () => {
      const result = await getConfirmedMealPlanItemIds(testUser.id, new Date());
      expect(result).toEqual([]);
    });

    it("returns item IDs confirmed today via meal_plan_confirm logs", async () => {
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: testRecipe.id,
        plannedDate: new Date().toISOString().slice(0, 10),
        mealType: "dinner",
        servings: "1",
      });

      // Insert a daily log confirming this item
      await tx.insert(dailyLogs).values({
        userId: testUser.id,
        mealPlanItemId: item.id,
        source: "meal_plan_confirm",
        servings: "1",
        loggedAt: new Date(),
      });

      const result = await getConfirmedMealPlanItemIds(testUser.id, new Date());
      expect(result).toContain(item.id);
    });
  });
});
