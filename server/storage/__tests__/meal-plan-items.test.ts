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
  familyProfiles,
} from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getMealPlanItems,
  getMealPlanItemSummaries,
  getMealPlanItemById,
  addMealPlanItem,
  removeMealPlanItem,
  reorderMealPlanItems,
  getConfirmedMealPlanItemIds,
  updateMealPlanItemAudience,
  isMealPlanItemConfirmed,
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

/** addMealPlanItem for fixtures: it returns undefined when the recipe isn't the user's live one. */
async function addItem(
  ...args: Parameters<typeof addMealPlanItem>
): Promise<NonNullable<Awaited<ReturnType<typeof addMealPlanItem>>>> {
  const item = await addMealPlanItem(...args);
  if (!item) throw new Error("fixture: addMealPlanItem refused the recipe");
  return item;
}

/** One self, one shared and one profile meal on 2026-05-15; returns the profile id too. */
async function seedAudienceMeals(userId: string) {
  const [profile] = await tx
    .insert(familyProfiles)
    .values({ userId, name: "Sam" })
    .returning();
  const recipe = await createRecipe(userId);
  const mk = (audience: "self" | "shared" | "profile") =>
    addItem({
      userId,
      recipeId: recipe.id,
      plannedDate: "2026-05-15",
      mealType: "dinner",
      audience,
      familyProfileId: audience === "profile" ? profile.id : null,
    });
  const self = await mk("self");
  const shared = await mk("shared");
  const forProfile = await mk("profile");
  return { profile, self, shared, forProfile };
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
      const item = await addItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "breakfast",
      });
      expect(item!.id).toBeGreaterThan(0);
      expect(item!.userId).toBe(testUser.id);
      expect(item!.recipeId).toBe(recipe.id);
      expect(item!.mealType).toBe("breakfast");
    });

    // The route checks the recipe first; a soft delete committing in between
    // used to leave a plan item on a deleted recipe (the FK no longer refuses
    // it), still counted by planned totals and grocery lists.
    it("refuses a recipe that has been soft-deleted", async () => {
      const recipe = await createRecipe(testUser.id);
      await tx
        .update(mealPlanRecipes)
        .set({ deletedAt: new Date() })
        .where(eq(mealPlanRecipes.id, recipe.id));

      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });

      expect(item).toBeUndefined();
      const rows = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.recipeId, recipe.id));
      expect(rows).toHaveLength(0);
    });

    // A Coach write-card save passes its own transaction: the live-recipe
    // check must run there too, not only on the default path.
    it("refuses a soft-deleted recipe when the caller passes its transaction", async () => {
      const recipe = await createRecipe(testUser.id);
      await tx
        .update(mealPlanRecipes)
        .set({ deletedAt: new Date() })
        .where(eq(mealPlanRecipes.id, recipe.id));

      const item = await addMealPlanItem(
        {
          userId: testUser.id,
          recipeId: recipe.id,
          plannedDate: "2026-05-15",
          mealType: "lunch",
        },
        tx,
      );

      expect(item).toBeUndefined();
    });

    it("inserts through the caller's transaction for a live recipe", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addMealPlanItem(
        {
          userId: testUser.id,
          recipeId: recipe.id,
          plannedDate: "2026-05-15",
          mealType: "lunch",
        },
        tx,
      );
      expect(item?.recipeId).toBe(recipe.id);
    });

    it("refuses another user's recipe", async () => {
      const other = await createTestUser(tx);
      const recipe = await createRecipe(other.id);

      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });

      expect(item).toBeUndefined();
    });
  });

  describe("getMealPlanItemSummaries", () => {
    it("returns narrow recipe / scanned-item rows with no heavy columns", async () => {
      const recipe = await createRecipe(testUser.id, {
        title: "Pasta",
        caloriesPerServing: "500",
        proteinPerServing: "20",
        carbsPerServing: "60",
        fatPerServing: "10",
      });
      const scanned = await createScannedItem(testUser.id, {
        productName: "Cheese",
        calories: "100",
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
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });

      const items = await getMealPlanItemSummaries(
        testUser.id,
        "2026-05-15",
        "2026-05-15",
      );
      expect(items).toHaveLength(2);
      const withRecipe = items.find((i) => i.recipeId === recipe.id);
      expect(withRecipe?.recipe).toEqual({
        id: recipe.id,
        title: "Pasta",
        caloriesPerServing: "500.00",
        proteinPerServing: "20.00",
        carbsPerServing: "60.00",
        fatPerServing: "10.00",
      });
      expect(withRecipe?.recipe).not.toHaveProperty("instructions");
      const withScanned = items.find((i) => i.scannedItemId === scanned.id);
      expect(withScanned?.scannedItem).toEqual({
        id: scanned.id,
        productName: "Cheese",
        calories: "100.00",
        protein: null,
        carbs: null,
        fat: null,
      });
    });

    it("excludes other users' items and soft-deleted / discarded relations", async () => {
      const other = await createTestUser(tx);
      const otherRecipe = await createRecipe(other.id, { title: "Theirs" });
      await addMealPlanItem({
        userId: other.id,
        recipeId: otherRecipe.id,
        plannedDate: "2026-05-15",
        mealType: "dinner",
      });
      const gone = await createRecipe(testUser.id, { title: "Gone" });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: gone.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      await tx
        .update(mealPlanRecipes)
        .set({ deletedAt: new Date() })
        .where(eq(mealPlanRecipes.id, gone.id));

      const items = await getMealPlanItemSummaries(
        testUser.id,
        "2026-05-15",
        "2026-05-15",
      );
      expect(items).toHaveLength(1);
      expect(items[0].recipe).toBeNull();
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
      const item = await addItem({
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
      const item = await addItem({
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
      const item = await addItem({
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
      const item = await addItem({
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
      const a = await addItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
        sortOrder: 0,
      });
      const b = await addItem({
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
      const other = await addItem({
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
      const ids = await getConfirmedMealPlanItemIds(
        testUser.id,
        new Date(),
        "UTC",
      );
      expect(ids).toEqual([]);
    });

    it("returns mealPlanItemIds for meal_plan_confirm logs on the given day", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addItem({
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

      const ids = await getConfirmedMealPlanItemIds(
        testUser.id,
        new Date(),
        "UTC",
      );
      expect(ids).toContain(item.id);
    });

    it("excludes logs from a different source", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addItem({
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
      const ids = await getConfirmedMealPlanItemIds(
        testUser.id,
        new Date(),
        "UTC",
      );
      expect(ids).not.toContain(item.id);
    });
  });

  describe("audience", () => {
    it("getMealPlanItems hides profile meals by default and shows them when asked", async () => {
      await seedAudienceMeals(testUser.id);
      const byDefault = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-15",
      );
      expect(byDefault.map((i) => i.audience).sort()).toEqual([
        "self",
        "shared",
      ]);
      const all = await getMealPlanItems(
        testUser.id,
        "2026-05-15",
        "2026-05-15",
        { includeProfileMeals: true },
      );
      expect(all).toHaveLength(3);
    });

    it("getMealPlanItemSummaries never returns profile meals", async () => {
      await seedAudienceMeals(testUser.id);
      const rows = await getMealPlanItemSummaries(
        testUser.id,
        "2026-05-15",
        "2026-05-15",
      );
      expect(rows).toHaveLength(2);
      expect(rows.some((r) => r.audience === "profile")).toBe(false);
    });

    it("updateMealPlanItemAudience changes the audience for the owner", async () => {
      const { self, profile } = await seedAudienceMeals(testUser.id);
      const updated = await updateMealPlanItemAudience(
        self.id,
        testUser.id,
        "profile",
        profile.id,
      );
      expect(updated?.audience).toBe("profile");
      expect(updated?.familyProfileId).toBe(profile.id);
      const back = await updateMealPlanItemAudience(
        self.id,
        testUser.id,
        "shared",
        null,
      );
      expect(back?.audience).toBe("shared");
      expect(back?.familyProfileId).toBeNull();
    });

    it("updateMealPlanItemAudience returns undefined for the wrong user and leaves the row", async () => {
      const { self } = await seedAudienceMeals(testUser.id);
      const other = await createTestUser(tx);
      const result = await updateMealPlanItemAudience(
        self.id,
        other.id,
        "shared",
        null,
      );
      expect(result).toBeUndefined();
      const [row] = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, self.id));
      expect(row.audience).toBe("self");
    });
  });

  describe("isMealPlanItemConfirmed", () => {
    it("is true only for the owner's confirmed item", async () => {
      const recipe = await createRecipe(testUser.id);
      const item = await addItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
      });
      expect(await isMealPlanItemConfirmed(item.id, testUser.id)).toBe(false);
      await tx.insert(dailyLogs).values({
        userId: testUser.id,
        recipeId: recipe.id,
        source: "meal_plan_confirm",
        mealPlanItemId: item.id,
        loggedAt: new Date(),
      });
      expect(await isMealPlanItemConfirmed(item.id, testUser.id)).toBe(true);
      const other = await createTestUser(tx);
      expect(await isMealPlanItemConfirmed(item.id, other.id)).toBe(false);
    });
  });
});
