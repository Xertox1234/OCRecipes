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
import {
  mealPlanRecipes,
  mealPlanItems,
  scannedItems,
  dailyLogs,
} from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

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

async function createRecipe(
  userId: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  const [r] = await tx
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Test Recipe",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return r;
}

async function createScannedItem(
  userId: string,
  overrides: Partial<schema.InsertScannedItem> = {},
): Promise<schema.ScannedItem> {
  const [s] = await tx
    .insert(scannedItems)
    .values({
      userId,
      productName: "Test Item",
      ...overrides,
    })
    .returning();
  return s;
}

describe("meal-plan-items storage", () => {
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

  describe("addMealPlanItem", () => {
    it("inserts and returns a meal plan item", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "breakfast",
      });
      expect(item.id).toBeGreaterThan(0);
      expect(item.userId).toBe(testUser.id);
      expect(item.recipeId).toBe(recipe.id);
      expect(item.mealType).toBe("breakfast");
    });
  });

  describe("getMealPlanItems", () => {
    it("returns empty array for a date range with no items", async () => {
      const items = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(items).toEqual([]);
    });

    it("returns items in the range with attached recipe / scannedItem", async () => {
      const recipe = await createRecipe(testUser.id, { title: "Pasta" });
      const scanned = await createScannedItem(testUser.id, {
        productName: "Cheese",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "dinner",
      });
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2026-05-16",
        mealType: "lunch",
      });

      const items = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(items).toHaveLength(2);
      const withRecipe = items.find((i) => i.recipeId === recipe.id);
      expect(withRecipe?.recipe?.title).toBe("Pasta");
      const withScanned = items.find((i) => i.scannedItemId === scanned.id);
      expect(withScanned?.scannedItem?.productName).toBe("Cheese");
    });

    it("excludes items outside the date range", async () => {
      const recipe = await createRecipe(testUser.id);
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-04-01",
        mealType: "lunch",
      });
      const items = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(items).toHaveLength(0);
    });

    it("scopes by userId", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createRecipe(otherUser.id);
      await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const items = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(items).toEqual([]);
    });

    it("returns scannedItem as null when the item has been soft-deleted", async () => {
      const scanned = await createScannedItem(testUser.id, {
        discardedAt: new Date(),
      });
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const items = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(items).toHaveLength(1);
      expect(items[0].scannedItem).toBeNull();
    });
  });

  describe("getMealPlanItemById", () => {
    it("returns undefined when the item does not exist", async () => {
      const result = await getMealPlanItemById(999999, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns undefined when the item belongs to another user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createRecipe(otherUser.id);
      const item = await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const result = await getMealPlanItemById(item.id, testUser.id);
      expect(result).toBeUndefined();
      // Dual-assertion: the foreign row must still exist.
      const rows = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, item.id));
      expect(rows).toHaveLength(1);
    });

    it("returns the item with recipe attached when owned by the user", async () => {
      const recipe = await createRecipe(testUser.id, { title: "Mine" });
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const result = await getMealPlanItemById(item.id, testUser.id);
      expect(result?.id).toBe(item.id);
      expect(result?.recipe?.title).toBe("Mine");
      expect(result?.scannedItem).toBeNull();
    });
  });

  describe("removeMealPlanItem", () => {
    it("returns false when the item does not exist", async () => {
      const result = await removeMealPlanItem(999999, testUser.id);
      expect(result).toBe(false);
    });

    it("deletes the row and returns true when owned", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const result = await removeMealPlanItem(item.id, testUser.id);
      expect(result).toBe(true);
      const rows = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, item.id));
      expect(rows).toHaveLength(0);
    });

    it("does not delete items owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createRecipe(otherUser.id);
      const item = await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      const result = await removeMealPlanItem(item.id, testUser.id);
      expect(result).toBe(false);
      // Dual-assertion IDOR check: the row must still exist after the
      // unauthorized delete attempt.
      const rows = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, item.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("reorderMealPlanItems", () => {
    it("is a no-op for empty input", async () => {
      await expect(
        reorderMealPlanItems(testUser.id, []),
      ).resolves.toBeUndefined();
    });

    it("updates sortOrder for owned items only", async () => {
      const recipe = await createRecipe(testUser.id);
      const a = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
        sortOrder: 0,
      });
      const b = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
        sortOrder: 1,
      });

      await reorderMealPlanItems(testUser.id, [
        { id: a.id, sortOrder: 10 },
        { id: b.id, sortOrder: 5 },
      ]);

      const [aAfter] = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, a.id));
      const [bAfter] = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, b.id));
      expect(aAfter.sortOrder).toBe(10);
      expect(bAfter.sortOrder).toBe(5);
    });

    it("does not touch items owned by other users", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createRecipe(otherUser.id);
      const other = await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
        sortOrder: 0,
      });

      await reorderMealPlanItems(testUser.id, [
        { id: other.id, sortOrder: 999 },
      ]);

      const [otherAfter] = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, other.id));
      expect(otherAfter.sortOrder).toBe(0);
    });
  });

  describe("getConfirmedMealPlanItemIds", () => {
    it("returns empty array when no confirmed logs exist for the day", async () => {
      const ids = await getConfirmedMealPlanItemIds(testUser.id, new Date());
      expect(ids).toEqual([]);
    });

    it("returns mealPlanItemIds for meal_plan_confirm logs on the given day", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      // Insert a dailyLog confirming this meal-plan item.
      await tx.insert(dailyLogs).values({
        userId: testUser.id,
        recipeId: recipe.id,
        source: "meal_plan_confirm",
        mealPlanItemId: item.id,
        loggedAt: new Date(),
      });

      const ids = await getConfirmedMealPlanItemIds(testUser.id, new Date());
      expect(ids).toContain(item.id);
    });

    it("excludes logs from a different source", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      await tx.insert(dailyLogs).values({
        userId: testUser.id,
        recipeId: recipe.id,
        source: "scan",
        mealPlanItemId: item.id,
        loggedAt: new Date(),
      });
      const ids = await getConfirmedMealPlanItemIds(testUser.id, new Date());
      expect(ids).not.toContain(item.id);
    });
  });
});
