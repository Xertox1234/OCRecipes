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
import { communityRecipes } from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock the search index to avoid side-effects and startup failures
vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  mealPlanToSearchable: vi.fn(() => ({})),
  getDocumentStore: vi.fn(() => new Map()),
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
} = await import("../meal-plan-recipes");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Create a minimal meal plan recipe for the given user. */
async function createTestRecipe(
  userId: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  return createMealPlanRecipe({
    userId,
    title: "Test Recipe",
    instructions: ["Step 1"],
    ...overrides,
  });
}

describe("meal-plan-recipes storage", () => {
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

  // --------------------------------------------------------------------------
  // findMealPlanRecipeByExternalId
  // --------------------------------------------------------------------------
  describe("findMealPlanRecipeByExternalId", () => {
    it("returns undefined when no recipe matches", async () => {
      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-001",
      );
      expect(result).toBeUndefined();
    });

    it("returns the recipe when externalId and userId match", async () => {
      const recipe = await createTestRecipe(testUser.id, {
        externalId: "ext-123",
      });

      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-123",
      );
      expect(result).toBeDefined();
      expect(result!.id).toBe(recipe.id);
    });

    it("returns undefined for a recipe owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      await createTestRecipe(otherUser.id, { externalId: "ext-456" });

      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-456",
      );
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getMealPlanRecipe
  // --------------------------------------------------------------------------
  describe("getMealPlanRecipe", () => {
    it("returns the recipe by id", async () => {
      const recipe = await createTestRecipe(testUser.id);

      const result = await getMealPlanRecipe(recipe.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(recipe.id);
    });

    it("returns undefined for nonexistent id", async () => {
      const result = await getMealPlanRecipe(999999);
      expect(result).toBeUndefined();
    });

    it("returns undefined when userId filter does not match", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestRecipe(otherUser.id);

      const result = await getMealPlanRecipe(recipe.id, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getMealPlanRecipeWithIngredients
  // --------------------------------------------------------------------------
  describe("getMealPlanRecipeWithIngredients", () => {
    it("returns undefined for nonexistent recipe", async () => {
      const result = await getMealPlanRecipeWithIngredients(999999);
      expect(result).toBeUndefined();
    });

    it("returns recipe with empty ingredients when none exist", async () => {
      const recipe = await createTestRecipe(testUser.id);
      const result = await getMealPlanRecipeWithIngredients(recipe.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(recipe.id);
      expect(result!.ingredients).toEqual([]);
    });

    it("returns recipe with its ingredients", async () => {
      const recipe = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "Pasta",
          instructions: ["Boil water"],
        },
        [
          { recipeId: 0, name: "Pasta", quantity: "200g", displayOrder: 0 },
          { recipeId: 0, name: "Salt", quantity: "1 tsp", displayOrder: 1 },
        ],
      );

      const result = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(result).toBeDefined();
      expect(result!.ingredients).toHaveLength(2);
      const names = result!.ingredients.map((i) => i.name);
      expect(names).toContain("Pasta");
      expect(names).toContain("Salt");
    });
  });

  // --------------------------------------------------------------------------
  // getUserMealPlanRecipes
  // --------------------------------------------------------------------------
  describe("getUserMealPlanRecipes", () => {
    it("returns empty items and total=0 when user has no recipes", async () => {
      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it("returns user's recipes and correct total", async () => {
      await createTestRecipe(testUser.id, { title: "Recipe A" });
      await createTestRecipe(testUser.id, { title: "Recipe B" });

      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("only returns recipes for the requesting user", async () => {
      const otherUser = await createTestUser(tx);
      await createTestRecipe(otherUser.id);
      await createTestRecipe(testUser.id);

      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toHaveLength(1);
    });

    it("respects limit and offset for pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await createTestRecipe(testUser.id, { title: `Recipe ${i}` });
      }

      const page = await getUserMealPlanRecipes(testUser.id, 2, 0);
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(5);
    });
  });

  // --------------------------------------------------------------------------
  // createMealPlanRecipe
  // --------------------------------------------------------------------------
  describe("createMealPlanRecipe", () => {
    it("creates a recipe without ingredients", async () => {
      const recipe = await createMealPlanRecipe({
        userId: testUser.id,
        title: "Simple Recipe",
        instructions: ["Do it"],
      });

      expect(recipe.id).toBeDefined();
      expect(recipe.title).toBe("Simple Recipe");
      expect(recipe.userId).toBe(testUser.id);
    });

    it("creates a recipe with ingredients in a transaction", async () => {
      const recipe = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "Complex Recipe",
          instructions: ["Cook"],
        },
        [{ recipeId: 0, name: "Flour", quantity: "1 cup", displayOrder: 0 }],
      );

      expect(recipe.id).toBeDefined();
      const full = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(full!.ingredients).toHaveLength(1);
      expect(full!.ingredients[0].name).toBe("Flour");
    });
  });

  // --------------------------------------------------------------------------
  // updateMealPlanRecipe
  // --------------------------------------------------------------------------
  describe("updateMealPlanRecipe", () => {
    it("updates and returns the recipe", async () => {
      const recipe = await createTestRecipe(testUser.id, {
        title: "Old Title",
      });

      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "New Title",
      });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe("New Title");
    });

    it("returns undefined when recipe does not belong to user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestRecipe(otherUser.id);

      const result = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "Hacked",
      });
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // deleteMealPlanRecipe
  // --------------------------------------------------------------------------
  describe("deleteMealPlanRecipe", () => {
    it("deletes a recipe and returns true", async () => {
      const recipe = await createTestRecipe(testUser.id);

      const result = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(result).toBe(true);

      const check = await getMealPlanRecipe(recipe.id);
      expect(check).toBeUndefined();
    });

    it("returns false when recipe does not belong to user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestRecipe(otherUser.id);

      const result = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getUnifiedRecipes
  // --------------------------------------------------------------------------
  describe("getUnifiedRecipes", () => {
    it("returns community and personal recipe lists", async () => {
      await createTestRecipe(testUser.id, { title: "Personal Recipe" });
      await tx.insert(communityRecipes).values({
        authorId: testUser.id,
        title: "Community Recipe",
        normalizedProductName: "test-unified-community",
        instructions: ["Step 1"],
        isPublic: true,
      });

      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result).toHaveProperty("community");
      expect(result).toHaveProperty("personal");
    });

    it("returns empty results when no recipes exist", async () => {
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.community).toHaveLength(0);
      expect(result.personal).toHaveLength(0);
    });
  });
});
