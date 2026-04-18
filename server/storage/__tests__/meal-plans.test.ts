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
  recipeIngredients,
  scannedItems,
  communityRecipes,
} from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  findMealPlanRecipeByExternalId,
  getMealPlanRecipe,
  getMealPlanRecipeWithIngredients,
  getUserMealPlanRecipes,
  createMealPlanRecipe,
  updateMealPlanRecipe,
  deleteMealPlanRecipe,
  getUnifiedRecipes,
  getMealPlanItems,
  getMealPlanItemById,
  addMealPlanItem,
  removeMealPlanItem,
  createGroceryList: _createGroceryList,
  getGroceryLists,
  getGroceryListWithItems,
  deleteGroceryList,
  addGroceryListItem,
  updateGroceryListItemChecked,
  deleteGroceryListItem,
  updateGroceryListItemPantryFlag,
  getPantryItems,
  getPantryItem,
  createPantryItem,
  updatePantryItem,
  deletePantryItem,
  getExpiringPantryItems,
  getPlannedNutritionSummary,
  getMealPlanIngredientsForDateRange,
  getFrequentRecipesForMealType,
  createMealPlanFromSuggestions,
} = await import("../meal-plans");

// Widen the insert type to allow passing `createdAt` for ordering tests.
const createGroceryList = _createGroceryList as (
  list: Parameters<typeof _createGroceryList>[0] & { createdAt?: Date },
) => ReturnType<typeof _createGroceryList>;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a meal plan recipe with sensible defaults. */
async function createTestMealPlanRecipe(
  userId: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
) {
  const defaults: schema.InsertMealPlanRecipe = {
    userId,
    title: "Test Recipe",
    description: "A test recipe",
    sourceType: "user_created",
    servings: 2,
    caloriesPerServing: "400",
    proteinPerServing: "30",
    carbsPerServing: "40",
    fatPerServing: "15",
    instructions: ["Step 1: Prepare ingredients", "Step 2: Cook and serve"],
    dietTags: [],
    ...overrides,
  };
  return createMealPlanRecipe(defaults);
}

/** Create a scanned item for use with meal plan items. */
async function createTestScannedItem(
  userId: string,
  overrides: Partial<schema.InsertScannedItem> = {},
) {
  const [item] = await tx
    .insert(scannedItems)
    .values({
      userId,
      productName: "Test Scanned Food",
      calories: "250",
      protein: "10",
      carbs: "30",
      fat: "8",
      ...overrides,
    })
    .returning();
  return item;
}

/** Create a community recipe for unified search tests. */
async function createTestCommunityRecipe(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const defaults = {
    authorId: userId,
    title: "Community Recipe",
    description: "Community test",
    // `test-` prefix: ensures global-teardown / cleanup-seed-recipes
    // catches any row that leaks past transaction rollback. See
    // `server/scripts/cleanup-seed-recipes-utils.ts`.
    normalizedProductName: "test-community food",
    instructions: ["Mix and serve"],
    isPublic: true,
    dietTags: [] as string[],
  };
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({ ...defaults, ...overrides })
    .returning();
  return recipe;
}

describe("meal-plans storage", () => {
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
  // MEAL PLAN RECIPES
  // ==========================================================================

  describe("findMealPlanRecipeByExternalId", () => {
    it("returns a recipe matching the userId and externalId", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        externalId: "spoon-123",
      });

      const found = await findMealPlanRecipeByExternalId(
        testUser.id,
        "spoon-123",
      );
      expect(found).toBeDefined();
      expect(found!.externalId).toBe("spoon-123");
    });

    it("returns undefined when externalId does not exist", async () => {
      const found = await findMealPlanRecipeByExternalId(
        testUser.id,
        "nonexistent",
      );
      expect(found).toBeUndefined();
    });

    it("does not return recipe belonging to a different user", async () => {
      const otherUser = await createTestUser(tx);
      await createTestMealPlanRecipe(otherUser.id, {
        externalId: "ext-999",
      });

      const found = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-999",
      );
      expect(found).toBeUndefined();
    });
  });

  describe("getMealPlanRecipe", () => {
    it("returns the recipe by id", async () => {
      const created = await createTestMealPlanRecipe(testUser.id, {
        title: "Find Me",
      });

      const found = await getMealPlanRecipe(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Find Me");
    });

    it("returns undefined for a non-existent id", async () => {
      const found = await getMealPlanRecipe(999999);
      expect(found).toBeUndefined();
    });
  });

  describe("getMealPlanRecipeWithIngredients", () => {
    it("returns recipe with empty ingredients array when none exist", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const result = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(recipe.id);
      expect(result!.ingredients).toEqual([]);
    });

    it("returns recipe with ingredients ordered by displayOrder", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        {
          recipeId: recipe.id,
          name: "Salt",
          displayOrder: 2,
        },
        {
          recipeId: recipe.id,
          name: "Flour",
          displayOrder: 0,
        },
        {
          recipeId: recipe.id,
          name: "Sugar",
          displayOrder: 1,
        },
      ]);

      const result = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(result!.ingredients).toHaveLength(3);
      expect(result!.ingredients.map((i) => i.name)).toEqual([
        "Flour",
        "Sugar",
        "Salt",
      ]);
    });

    it("returns undefined for a non-existent recipe id", async () => {
      const result = await getMealPlanRecipeWithIngredients(999999);
      expect(result).toBeUndefined();
    });
  });

  describe("getUserMealPlanRecipes", () => {
    it("returns items and total count for the user", async () => {
      await createTestMealPlanRecipe(testUser.id, { title: "A" });
      await createTestMealPlanRecipe(testUser.id, { title: "B" });
      await createTestMealPlanRecipe(testUser.id, { title: "C" });

      const { items, total } = await getUserMealPlanRecipes(testUser.id);
      expect(items).toHaveLength(3);
      expect(total).toBe(3);
    });

    it("does not include recipes from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createTestMealPlanRecipe(testUser.id, { title: "Mine" });
      await createTestMealPlanRecipe(otherUser.id, { title: "Theirs" });

      const { items, total } = await getUserMealPlanRecipes(testUser.id);
      expect(items).toHaveLength(1);
      expect(total).toBe(1);
      expect(items[0].title).toBe("Mine");
    });

    it("respects limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await createTestMealPlanRecipe(testUser.id, { title: `Recipe ${i}` });
      }

      const { items, total } = await getUserMealPlanRecipes(testUser.id, 2, 0);
      expect(items).toHaveLength(2);
      expect(total).toBe(5);

      const page2 = await getUserMealPlanRecipes(testUser.id, 2, 2);
      expect(page2.items).toHaveLength(2);
      expect(page2.total).toBe(5);
    });
  });

  describe("createMealPlanRecipe", () => {
    it("creates a recipe without ingredients", async () => {
      const recipe = await createMealPlanRecipe({
        userId: testUser.id,
        title: "Simple Recipe",
      });

      expect(recipe.id).toBeDefined();
      expect(recipe.title).toBe("Simple Recipe");
      expect(recipe.userId).toBe(testUser.id);
      expect(recipe.createdAt).toBeInstanceOf(Date);
    });

    it("creates a recipe with ingredients in a transaction", async () => {
      const recipe = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "Full Recipe",
          caloriesPerServing: "500",
        },
        [
          { recipeId: 0, name: "Chicken", quantity: "200", unit: "g" },
          { recipeId: 0, name: "Rice", quantity: "100", unit: "g" },
        ],
      );

      expect(recipe.id).toBeDefined();
      expect(recipe.title).toBe("Full Recipe");

      // Verify ingredients were created with correct recipeId
      const withIngredients = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(withIngredients!.ingredients).toHaveLength(2);
      expect(withIngredients!.ingredients[0].recipeId).toBe(recipe.id);
      expect(withIngredients!.ingredients[1].recipeId).toBe(recipe.id);
    });

    it("assigns displayOrder from index when not provided", async () => {
      const recipe = await createMealPlanRecipe(
        { userId: testUser.id, title: "Ordered" },
        [
          { recipeId: 0, name: "First" },
          { recipeId: 0, name: "Second" },
          { recipeId: 0, name: "Third" },
        ],
      );

      const withIngredients = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(withIngredients!.ingredients[0].displayOrder).toBe(0);
      expect(withIngredients!.ingredients[1].displayOrder).toBe(1);
      expect(withIngredients!.ingredients[2].displayOrder).toBe(2);
    });

    it("defaults to empty mealTypes when not provided (inference moved to route layer)", async () => {
      const recipe = await createMealPlanRecipe({
        userId: testUser.id,
        title: "Blueberry Pancakes",
      });
      expect(recipe.mealTypes).toEqual([]);
    });

    it("preserves explicitly provided mealTypes", async () => {
      const recipe = await createMealPlanRecipe({
        userId: testUser.id,
        title: "Blueberry Pancakes",
        mealTypes: ["snack"],
      });
      expect(recipe.mealTypes).toEqual(["snack"]);
    });
  });

  describe("updateMealPlanRecipe", () => {
    it("updates a recipe belonging to the user", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Old Title",
      });

      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "New Title",
        cuisine: "Italian",
      });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe("New Title");
      expect(updated!.cuisine).toBe("Italian");
      expect(updated!.updatedAt!.getTime()).toBeGreaterThanOrEqual(
        recipe.createdAt!.getTime(),
      );
    });

    it("returns undefined when another user tries to update (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Original",
      });

      const result = await updateMealPlanRecipe(recipe.id, otherUser.id, {
        title: "Hacked",
      });
      expect(result).toBeUndefined();

      // Original should be unchanged
      const original = await getMealPlanRecipe(recipe.id);
      expect(original!.title).toBe("Original");
    });
  });

  describe("deleteMealPlanRecipe", () => {
    it("deletes a recipe owned by the user and returns true", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const deleted = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getMealPlanRecipe(recipe.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const deleted = await deleteMealPlanRecipe(recipe.id, otherUser.id);
      expect(deleted).toBe(false);

      const found = await getMealPlanRecipe(recipe.id);
      expect(found).toBeDefined();
    });

    it("returns false when recipe does not exist", async () => {
      const deleted = await deleteMealPlanRecipe(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("getUnifiedRecipes", () => {
    it("returns community and personal recipes", async () => {
      await createTestMealPlanRecipe(testUser.id, { title: "Personal Pasta" });
      await createTestCommunityRecipe(testUser.id, {
        title: "Community Pasta",
      });

      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal).toHaveLength(1);
      // Community recipes include pre-existing public ones, so just check ours is included
      expect(result.community.some((r) => r.title === "Community Pasta")).toBe(
        true,
      );
      expect(result.personal[0].title).toBe("Personal Pasta");
    });

    it("filters by query (ILIKE) on title and description", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        title: "Chicken Tikka",
        description: "Spicy grilled chicken",
      });
      await createTestMealPlanRecipe(testUser.id, {
        title: "Beef Stew",
        description: "Hearty stew",
      });

      const result = await getUnifiedRecipes({
        userId: testUser.id,
        query: "chicken",
      });
      expect(result.personal).toHaveLength(1);
      expect(result.personal[0].title).toBe("Chicken Tikka");
    });

    it("filters personal recipes by cuisine", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        title: "Spaghetti",
        cuisine: "Italian",
      });
      await createTestMealPlanRecipe(testUser.id, {
        title: "Tacos",
        cuisine: "Mexican",
      });

      const result = await getUnifiedRecipes({
        userId: testUser.id,
        cuisine: "Italian",
      });
      expect(result.personal).toHaveLength(1);
      expect(result.personal[0].title).toBe("Spaghetti");
    });

    it("filters by diet tags (jsonb containment)", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        title: "Vegan Bowl",
        dietTags: ["vegan", "gluten-free"],
      });
      await createTestMealPlanRecipe(testUser.id, {
        title: "Steak Dinner",
        dietTags: ["keto"],
      });

      const result = await getUnifiedRecipes({
        userId: testUser.id,
        diet: "vegan",
      });
      expect(result.personal).toHaveLength(1);
      expect(result.personal[0].title).toBe("Vegan Bowl");
    });

    it("filters personal recipes by mealType", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        title: "Breakfast Pancakes",
        mealTypes: ["breakfast"],
      });
      await createTestMealPlanRecipe(testUser.id, {
        title: "Dinner Steak",
        mealTypes: ["dinner"],
      });

      const result = await getUnifiedRecipes({
        userId: testUser.id,
        mealType: "breakfast",
      });
      expect(result.personal).toHaveLength(1);
      expect(result.personal[0].title).toBe("Breakfast Pancakes");
    });

    it("includes un-tagged recipes (empty mealTypes) when filtering by mealType", async () => {
      await createTestMealPlanRecipe(testUser.id, {
        title: "Pancakes",
        mealTypes: ["breakfast"],
      });
      await createTestMealPlanRecipe(testUser.id, {
        title: "Legacy Recipe",
        mealTypes: [],
      });

      const result = await getUnifiedRecipes({
        userId: testUser.id,
        mealType: "breakfast",
      });
      expect(result.personal).toHaveLength(2);
    });
  });

  // ==========================================================================
  // MEAL PLAN ITEMS
  // ==========================================================================

  describe("addMealPlanItem", () => {
    it("creates a meal plan item and returns it", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
        servings: "2",
      });

      expect(item.id).toBeDefined();
      expect(item.userId).toBe(testUser.id);
      expect(item.recipeId).toBe(recipe.id);
      expect(item.plannedDate).toBe("2025-06-15");
      expect(item.mealType).toBe("dinner");
    });
  });

  describe("getMealPlanItems", () => {
    it("returns items with joined recipe and scannedItem within date range", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Dinner Recipe",
      });
      const scanned = await createTestScannedItem(testUser.id);

      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-16",
        mealType: "lunch",
      });

      const items = await getMealPlanItems(
        testUser.id,
        "2025-06-15",
        "2025-06-16",
      );
      expect(items).toHaveLength(2);

      const recipeItem = items.find((i) => i.recipeId === recipe.id);
      expect(recipeItem!.recipe).toBeDefined();
      expect(recipeItem!.recipe!.title).toBe("Dinner Recipe");
      expect(recipeItem!.scannedItem).toBeNull();

      const scannedItemEntry = items.find(
        (i) => i.scannedItemId === scanned.id,
      );
      expect(scannedItemEntry!.scannedItem).toBeDefined();
      expect(scannedItemEntry!.scannedItem!.productName).toBe(
        "Test Scanned Food",
      );
      expect(scannedItemEntry!.recipe).toBeNull();
    });

    it("excludes items outside the date range", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-10",
        mealType: "dinner",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-20",
        mealType: "dinner",
      });

      const items = await getMealPlanItems(
        testUser.id,
        "2025-06-14",
        "2025-06-16",
      );
      expect(items).toHaveLength(0);
    });

    it("does not return items from other users", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const items = await getMealPlanItems(
        testUser.id,
        "2025-06-15",
        "2025-06-15",
      );
      expect(items).toHaveLength(0);
    });

    it("excludes soft-deleted scanned items from enrichment", async () => {
      const scanned = await createTestScannedItem(testUser.id, {
        discardedAt: new Date(),
      });
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-15",
        mealType: "lunch",
      });

      const items = await getMealPlanItems(
        testUser.id,
        "2025-06-15",
        "2025-06-15",
      );
      expect(items).toHaveLength(1);
      expect(items[0].scannedItem).toBeNull();
    });
  });

  describe("getMealPlanItemById", () => {
    it("returns item with joined recipe", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Joined Recipe",
      });
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "breakfast",
      });

      const found = await getMealPlanItemById(item.id, testUser.id);
      expect(found).toBeDefined();
      expect(found!.recipe).toBeDefined();
      expect(found!.recipe!.title).toBe("Joined Recipe");
      expect(found!.scannedItem).toBeNull();
    });

    it("returns undefined when a different user requests it (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const found = await getMealPlanItemById(item.id, otherUser.id);
      expect(found).toBeUndefined();
    });

    it("returns undefined for non-existent item", async () => {
      const found = await getMealPlanItemById(999999, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns null scannedItem when linked scanned item is soft-deleted", async () => {
      const scanned = await createTestScannedItem(testUser.id, {
        discardedAt: new Date(),
      });
      const item = await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-15",
        mealType: "lunch",
      });

      const found = await getMealPlanItemById(item.id, testUser.id);
      expect(found).toBeDefined();
      expect(found!.scannedItem).toBeNull();
    });
  });

  describe("removeMealPlanItem", () => {
    it("removes an item owned by the user and returns true", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const removed = await removeMealPlanItem(item.id, testUser.id);
      expect(removed).toBe(true);

      const found = await getMealPlanItemById(item.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to remove (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(testUser.id);
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const removed = await removeMealPlanItem(item.id, otherUser.id);
      expect(removed).toBe(false);

      const found = await getMealPlanItemById(item.id, testUser.id);
      expect(found).toBeDefined();
    });
  });

  // ==========================================================================
  // GROCERY LISTS
  // ==========================================================================

  describe("createGroceryList", () => {
    it("creates a grocery list and returns it", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Weekly Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      expect(list.id).toBeDefined();
      expect(list.title).toBe("Weekly Shop");
      expect(list.userId).toBe(testUser.id);
      expect(list.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("getGroceryLists", () => {
    it("returns lists for the user ordered by createdAt desc", async () => {
      await createGroceryList({
        userId: testUser.id,
        title: "First",
        dateRangeStart: "2025-06-01",
        dateRangeEnd: "2025-06-07",
        createdAt: new Date("2025-01-01T10:00:00Z"),
      });
      await createGroceryList({
        userId: testUser.id,
        title: "Second",
        dateRangeStart: "2025-06-08",
        dateRangeEnd: "2025-06-14",
        createdAt: new Date("2025-01-01T12:00:00Z"),
      });

      const lists = await getGroceryLists(testUser.id);
      expect(lists).toHaveLength(2);
      // Most recent first
      expect(lists[0].title).toBe("Second");
      expect(lists[1].title).toBe("First");
    });

    it("does not return lists from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createGroceryList({
        userId: otherUser.id,
        title: "Other User List",
        dateRangeStart: "2025-06-01",
        dateRangeEnd: "2025-06-07",
      });

      const lists = await getGroceryLists(testUser.id);
      expect(lists).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createGroceryList({
          userId: testUser.id,
          title: `List ${i}`,
          dateRangeStart: "2025-06-01",
          dateRangeEnd: "2025-06-07",
        });
      }

      const lists = await getGroceryLists(testUser.id, 3);
      expect(lists).toHaveLength(3);
    });
  });

  describe("getGroceryListWithItems", () => {
    it("returns list with its items", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
        category: "dairy",
      });
      await addGroceryListItem({
        groceryListId: list.id,
        name: "Bread",
        category: "bakery",
      });

      const result = await getGroceryListWithItems(list.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.title).toBe("Shop");
      expect(result!.items).toHaveLength(2);
    });

    it("returns undefined for a different user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const list = await createGroceryList({
        userId: testUser.id,
        title: "My List",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const result = await getGroceryListWithItems(list.id, otherUser.id);
      expect(result).toBeUndefined();
    });
  });

  describe("deleteGroceryList", () => {
    it("deletes a list owned by the user and returns true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Delete Me",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const deleted = await deleteGroceryList(list.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getGroceryListWithItems(list.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Protected",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const deleted = await deleteGroceryList(list.id, otherUser.id);
      expect(deleted).toBe(false);

      const found = await getGroceryListWithItems(list.id, testUser.id);
      expect(found).toBeDefined();
    });
  });

  describe("addGroceryListItem", () => {
    it("creates a grocery list item and returns it", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Bananas",
        quantity: "6",
        unit: "pcs",
        category: "produce",
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe("Bananas");
      expect(item.isChecked).toBe(false);
      expect(item.addedToPantry).toBe(false);
    });
  });

  describe("updateGroceryListItemChecked", () => {
    it("checks an item and sets checkedAt", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      const updated = await updateGroceryListItemChecked(
        item.id,
        list.id,
        true,
      );
      expect(updated).toBeDefined();
      expect(updated!.isChecked).toBe(true);
      expect(updated!.checkedAt).toBeInstanceOf(Date);
    });

    it("unchecks an item and clears checkedAt", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      // Check first
      await updateGroceryListItemChecked(item.id, list.id, true);
      // Then uncheck
      const unchecked = await updateGroceryListItemChecked(
        item.id,
        list.id,
        false,
      );
      expect(unchecked!.isChecked).toBe(false);
      expect(unchecked!.checkedAt).toBeNull();
    });

    it("returns undefined for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      const result = await updateGroceryListItemChecked(item.id, 999999, true);
      expect(result).toBeUndefined();
    });
  });

  describe("deleteGroceryListItem", () => {
    it("deletes the item and returns true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Eggs",
      });

      const deleted = await deleteGroceryListItem(item.id, list.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const listWithItems = await getGroceryListWithItems(list.id, testUser.id);
      expect(listWithItems!.items).toHaveLength(0);
    });

    it("returns false for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Eggs",
      });

      const deleted = await deleteGroceryListItem(item.id, 999999);
      expect(deleted).toBe(false);
    });
  });

  describe("updateGroceryListItemPantryFlag", () => {
    it("sets addedToPantry to true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      const updated = await updateGroceryListItemPantryFlag(
        item.id,
        list.id,
        true,
      );
      expect(updated).toBeDefined();
      expect(updated!.addedToPantry).toBe(true);
    });

    it("sets addedToPantry back to false", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      await updateGroceryListItemPantryFlag(item.id, list.id, true);
      const updated = await updateGroceryListItemPantryFlag(
        item.id,
        list.id,
        false,
      );
      expect(updated!.addedToPantry).toBe(false);
    });

    it("returns undefined for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      const result = await updateGroceryListItemPantryFlag(
        item.id,
        999999,
        true,
      );
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // PANTRY ITEMS
  // ==========================================================================

  describe("createPantryItem", () => {
    it("creates a pantry item and returns it", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Olive Oil",
        quantity: "1",
        unit: "bottle",
        category: "oils",
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe("Olive Oil");
      expect(item.userId).toBe(testUser.id);
      expect(item.addedAt).toBeInstanceOf(Date);
    });
  });

  describe("getPantryItems", () => {
    it("returns pantry items for the user", async () => {
      await createPantryItem({
        userId: testUser.id,
        name: "Salt",
        category: "spices",
      });
      await createPantryItem({
        userId: testUser.id,
        name: "Pepper",
        category: "spices",
      });

      const items = await getPantryItems(testUser.id);
      expect(items).toHaveLength(2);
    });

    it("does not return items from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createPantryItem({
        userId: otherUser.id,
        name: "Secret Spice",
      });

      const items = await getPantryItems(testUser.id);
      expect(items).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createPantryItem({
          userId: testUser.id,
          name: `Item ${i}`,
        });
      }

      const items = await getPantryItems(testUser.id, 3);
      expect(items).toHaveLength(3);
    });
  });

  describe("getPantryItem", () => {
    it("returns the item for the correct user", async () => {
      const created = await createPantryItem({
        userId: testUser.id,
        name: "Flour",
      });

      const found = await getPantryItem(created.id, testUser.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Flour");
    });

    it("returns undefined for a different user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const created = await createPantryItem({
        userId: testUser.id,
        name: "Flour",
      });

      const found = await getPantryItem(created.id, otherUser.id);
      expect(found).toBeUndefined();
    });
  });

  describe("updatePantryItem", () => {
    it("updates a pantry item and sets updatedAt", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Old Name",
        quantity: "1",
      });

      const updated = await updatePantryItem(item.id, testUser.id, {
        name: "New Name",
        quantity: "5",
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("New Name");
      expect(updated!.quantity).toBe("5.00");
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        item.addedAt.getTime(),
      );
    });

    it("returns undefined when another user tries to update (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Protected",
      });

      const result = await updatePantryItem(item.id, otherUser.id, {
        name: "Hacked",
      });
      expect(result).toBeUndefined();

      const original = await getPantryItem(item.id, testUser.id);
      expect(original!.name).toBe("Protected");
    });
  });

  describe("deletePantryItem", () => {
    it("deletes the item and returns true", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Delete Me",
      });

      const deleted = await deletePantryItem(item.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getPantryItem(item.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Protected",
      });

      const deleted = await deletePantryItem(item.id, otherUser.id);
      expect(deleted).toBe(false);

      const found = await getPantryItem(item.id, testUser.id);
      expect(found).toBeDefined();
    });

    it("returns false for non-existent item", async () => {
      const deleted = await deletePantryItem(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("getExpiringPantryItems", () => {
    it("returns items expiring within the given number of days", async () => {
      const soonExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days
      const laterExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createPantryItem({
        userId: testUser.id,
        name: "Expiring Soon",
        expiresAt: soonExpiry,
      });
      await createPantryItem({
        userId: testUser.id,
        name: "Expires Later",
        expiresAt: laterExpiry,
      });
      await createPantryItem({
        userId: testUser.id,
        name: "No Expiry",
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(1);
      expect(expiring[0].name).toBe("Expiring Soon");
    });

    it("does not return already expired items", async () => {
      const pastExpiry = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // yesterday

      await createPantryItem({
        userId: testUser.id,
        name: "Already Expired",
        expiresAt: pastExpiry,
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(0);
    });

    it("does not return expiring items from other users", async () => {
      const otherUser = await createTestUser(tx);
      const soonExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      await createPantryItem({
        userId: otherUser.id,
        name: "Other User Expiring",
        expiresAt: soonExpiry,
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(0);
    });
  });

  // ==========================================================================
  // MEAL CONFIRMATION / AGGREGATION
  // ==========================================================================

  describe("getPlannedNutritionSummary", () => {
    it("sums nutrition from planned items for a given date", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        caloriesPerServing: "300",
        proteinPerServing: "25",
        carbsPerServing: "35",
        fatPerServing: "10",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "lunch",
        servings: "2",
      });

      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
      );

      expect(Number(summary.plannedCalories)).toBeCloseTo(600, 0);
      expect(Number(summary.plannedProtein)).toBeCloseTo(50, 0);
      expect(Number(summary.plannedCarbs)).toBeCloseTo(70, 0);
      expect(Number(summary.plannedFat)).toBeCloseTo(20, 0);
      expect(Number(summary.plannedItemCount)).toBe(1);
    });

    it("excludes items whose ids are passed as confirmedIds", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        caloriesPerServing: "400",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "15",
      });
      const item1 = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "lunch",
        servings: "1",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
        servings: "1",
      });

      // Exclude item1 via confirmedIds
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
        [item1.id],
      );

      // Only item2 should be counted
      expect(Number(summary.plannedCalories)).toBeCloseTo(400, 0);
      expect(Number(summary.plannedItemCount)).toBe(1);
    });

    it("returns zeros when no items are planned", async () => {
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
      );

      expect(Number(summary.plannedCalories)).toBe(0);
      expect(Number(summary.plannedProtein)).toBe(0);
      expect(Number(summary.plannedCarbs)).toBe(0);
      expect(Number(summary.plannedFat)).toBe(0);
      expect(Number(summary.plannedItemCount)).toBe(0);
    });

    it("returns zeros when all items are confirmed", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        caloriesPerServing: "500",
      });
      const item = await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
        servings: "1",
      });

      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
        [item.id],
      );

      expect(Number(summary.plannedCalories)).toBe(0);
      expect(Number(summary.plannedItemCount)).toBe(0);
    });

    it("includes nutrition from scanned-item-backed meal plan items", async () => {
      const scanned = await createTestScannedItem(testUser.id);
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-15",
        mealType: "snack",
        servings: "1",
      });

      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
      );

      // createTestScannedItem uses: calories=250, protein=10, carbs=30, fat=8
      expect(Number(summary.plannedCalories)).toBeCloseTo(250, 0);
      expect(Number(summary.plannedProtein)).toBeCloseTo(10, 0);
      expect(Number(summary.plannedCarbs)).toBeCloseTo(30, 0);
      expect(Number(summary.plannedFat)).toBeCloseTo(8, 0);
      expect(Number(summary.plannedItemCount)).toBe(1);
    });

    it("excludes soft-deleted scanned items from planned nutrition", async () => {
      const scanned = await createTestScannedItem(testUser.id, {
        discardedAt: new Date(),
      });
      await addMealPlanItem({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2025-06-15",
        mealType: "snack",
        servings: "1",
      });

      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2025-06-15"),
      );

      // Item still counted but contributes 0 nutrition
      expect(Number(summary.plannedItemCount)).toBe(1);
      expect(Number(summary.plannedCalories)).toBe(0);
    });
  });

  describe("getMealPlanIngredientsForDateRange", () => {
    it("returns all ingredients for recipes in the date range", async () => {
      const recipe = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "With Ingredients",
        },
        [
          { recipeId: 0, name: "Chicken", quantity: "500", unit: "g" },
          { recipeId: 0, name: "Broccoli", quantity: "200", unit: "g" },
        ],
      );
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const ingredients = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2025-06-15",
        "2025-06-15",
      );

      expect(ingredients).toHaveLength(2);
      const names = ingredients.map((i) => i.name).sort();
      expect(names).toEqual(["Broccoli", "Chicken"]);
    });

    it("returns empty array when no recipe items are in the range", async () => {
      const ingredients = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2025-06-15",
        "2025-06-21",
      );
      expect(ingredients).toEqual([]);
    });

    it("deduplicates recipe ids across multiple meal plan items", async () => {
      const recipe = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "Shared Recipe",
        },
        [{ recipeId: 0, name: "Pasta", quantity: "300", unit: "g" }],
      );

      // Same recipe planned on two different days
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-16",
        mealType: "dinner",
      });

      const ingredients = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2025-06-15",
        "2025-06-16",
      );

      // Even though recipe is used twice, ingredients should only appear once
      // (the query deduplicates by recipeId)
      expect(ingredients).toHaveLength(1);
      expect(ingredients[0].name).toBe("Pasta");
    });

    it("excludes items from other users", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createMealPlanRecipe(
        {
          userId: otherUser.id,
          title: "Other Recipe",
        },
        [{ recipeId: 0, name: "Secret Ingredient" }],
      );
      await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-15",
        mealType: "dinner",
      });

      const ingredients = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2025-06-15",
        "2025-06-15",
      );
      expect(ingredients).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getFrequentRecipesForMealType
  // -----------------------------------------------------------------------

  describe("getFrequentRecipesForMealType", () => {
    it("returns recipes ordered by frequency", async () => {
      const recipeA = await createTestMealPlanRecipe(testUser.id, {
        title: "Oatmeal",
      });
      const recipeB = await createTestMealPlanRecipe(testUser.id, {
        title: "Pancakes",
      });

      // Use recipeA once, recipeB twice for breakfast
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipeA.id,
        plannedDate: "2025-06-01",
        mealType: "breakfast",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipeB.id,
        plannedDate: "2025-06-02",
        mealType: "breakfast",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipeB.id,
        plannedDate: "2025-06-03",
        mealType: "breakfast",
      });

      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(recipeB.id); // more frequent first
      expect(result[1].id).toBe(recipeA.id);
    });

    it("returns empty array when no items for meal type", async () => {
      const result = await getFrequentRecipesForMealType(testUser.id, "lunch");
      expect(result).toEqual([]);
    });

    it("only returns recipes for the specified meal type", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Salad",
      });
      await addMealPlanItem({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-01",
        mealType: "lunch",
      });

      const breakfast = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(breakfast).toEqual([]);

      const lunch = await getFrequentRecipesForMealType(testUser.id, "lunch");
      expect(lunch).toHaveLength(1);
      expect(lunch[0].id).toBe(recipe.id);
    });

    it("does not return other user's frequent recipes", async () => {
      const otherUser = await createTestUser(tx, { username: "other-freq" });
      const recipe = await createTestMealPlanRecipe(otherUser.id, {
        title: "Other User Recipe",
      });
      await addMealPlanItem({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2025-06-01",
        mealType: "dinner",
      });

      const result = await getFrequentRecipesForMealType(testUser.id, "dinner");
      expect(result).toEqual([]);
    });

    it("respects the limit parameter", async () => {
      const recipes = [];
      for (let i = 0; i < 5; i++) {
        recipes.push(
          await createTestMealPlanRecipe(testUser.id, {
            title: `Snack ${i}`,
          }),
        );
        await addMealPlanItem({
          userId: testUser.id,
          recipeId: recipes[i].id,
          plannedDate: `2025-06-0${i + 1}`,
          mealType: "snack",
        });
      }

      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "snack",
        3,
      );
      expect(result).toHaveLength(3);
    });
  });

  // ==========================================================================
  // BULK MEAL PLAN CREATION
  // ==========================================================================

  describe("createMealPlanFromSuggestions", () => {
    it("creates a single meal with recipe, ingredients, and plan item", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: {
            userId: testUser.id,
            title: "Chicken Rice",
            sourceType: "ai_suggestion",
            servings: 2,
            caloriesPerServing: "400",
            proteinPerServing: "30",
            carbsPerServing: "40",
            fatPerServing: "15",
            dietTags: ["high-protein"],
          },
          ingredients: [
            { name: "Chicken", quantity: "200", unit: "g", displayOrder: 0 },
            { name: "Rice", quantity: "150", unit: "g", displayOrder: 1 },
          ],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-03-28",
            mealType: "lunch",
            servings: "2",
          },
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].recipeId).toBeDefined();
      expect(result[0].mealPlanItemId).toBeDefined();

      // Verify recipe was created
      const recipe = await getMealPlanRecipe(result[0].recipeId);
      expect(recipe).toBeDefined();
      expect(recipe!.title).toBe("Chicken Rice");

      // Verify ingredients were created
      const t = getTestTx();
      const ings = await t
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[0].recipeId));
      expect(ings).toHaveLength(2);
      expect(ings[0].name).toBe("Chicken");
      expect(ings[1].name).toBe("Rice");

      // Verify plan item was created
      const planItem = await getMealPlanItemById(
        result[0].mealPlanItemId,
        testUser.id,
      );
      expect(planItem).toBeDefined();
    });

    it("creates multiple meals atomically", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: {
            userId: testUser.id,
            title: "Meal 1",
            sourceType: "ai_suggestion",
            servings: 1,
            caloriesPerServing: "300",
            proteinPerServing: "20",
            carbsPerServing: "30",
            fatPerServing: "10",
            dietTags: [],
          },
          ingredients: [
            {
              name: "Ingredient A",
              quantity: "100",
              unit: "g",
              displayOrder: 0,
            },
          ],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-03-28",
            mealType: "breakfast",
            servings: "1",
          },
        },
        {
          recipe: {
            userId: testUser.id,
            title: "Meal 2",
            sourceType: "ai_suggestion",
            servings: 1,
            caloriesPerServing: "500",
            proteinPerServing: "35",
            carbsPerServing: "50",
            fatPerServing: "20",
            dietTags: [],
          },
          ingredients: [
            {
              name: "Ingredient B",
              quantity: "200",
              unit: "g",
              displayOrder: 0,
            },
          ],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-03-28",
            mealType: "dinner",
            servings: "1",
          },
        },
      ]);

      expect(result).toHaveLength(2);
      // Verify both recipes exist
      const recipe1 = await getMealPlanRecipe(result[0].recipeId);
      const recipe2 = await getMealPlanRecipe(result[1].recipeId);
      expect(recipe1!.title).toBe("Meal 1");
      expect(recipe2!.title).toBe("Meal 2");
    });

    it("handles meals with no ingredients", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: {
            userId: testUser.id,
            title: "Simple Meal",
            sourceType: "ai_suggestion",
            servings: 1,
            caloriesPerServing: "200",
            proteinPerServing: "15",
            carbsPerServing: "20",
            fatPerServing: "8",
            dietTags: [],
          },
          ingredients: [],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-03-29",
            mealType: "snack",
            servings: "1",
          },
        },
      ]);

      expect(result).toHaveLength(1);
      // Verify no ingredients
      const t = getTestTx();
      const ings = await t
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[0].recipeId));
      expect(ings).toHaveLength(0);
    });
  });
});
