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
import { mealPlanRecipes, communityRecipes } from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock fire-and-forget so orphan cleanup can be awaited in tests
let lastFireAndForgetPromise: Promise<unknown> | null = null;
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    lastFireAndForgetPromise = promise;
  },
}));

// Import after mocking
const {
  createCookbook,
  getUserCookbooks,
  getCookbook,
  updateCookbook,
  deleteCookbook,
  addRecipeToCookbook,
  removeRecipeFromCookbook,
  getCookbookRecipes,
  getResolvedCookbookRecipes,
} = await import("../cookbooks");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Insert a mealPlan recipe owned by the given user. */
async function createTestMealPlanRecipe(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<schema.MealPlanRecipe> {
  const [recipe] = await tx
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Test Meal Plan Recipe",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return recipe;
}

/** Insert a community recipe. */
async function createTestCommunityRecipe(
  authorId: string,
  overrides: Record<string, unknown> = {},
): Promise<schema.CommunityRecipe> {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId,
      title: "Test Community Recipe",
      normalizedProductName: "test-community-recipe",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("cookbooks storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    lastFireAndForgetPromise = null;
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // --------------------------------------------------------------------------
  // createCookbook
  // --------------------------------------------------------------------------
  describe("createCookbook", () => {
    it("creates a cookbook and returns it", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
        description: "A test cookbook",
      });

      expect(cookbook.id).toBeDefined();
      expect(cookbook.name).toBe("My Cookbook");
      expect(cookbook.description).toBe("A test cookbook");
      expect(cookbook.userId).toBe(testUser.id);
      expect(cookbook.createdAt).toBeInstanceOf(Date);
    });
  });

  // --------------------------------------------------------------------------
  // getUserCookbooks
  // --------------------------------------------------------------------------
  describe("getUserCookbooks", () => {
    it("returns empty array when user has no cookbooks", async () => {
      const result = await getUserCookbooks(testUser.id);
      expect(result).toEqual([]);
    });

    it("returns cookbooks with recipeCount for the user", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Pasta Recipes",
      });

      const result = await getUserCookbooks(testUser.id);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(cookbook.id);
      expect(result[0].recipeCount).toBe(0);
    });

    it("only returns cookbooks for the requesting user", async () => {
      const otherUser = await createTestUser(tx);
      await createCookbook({ userId: otherUser.id, name: "Other Cookbook" });
      await createCookbook({ userId: testUser.id, name: "My Cookbook" });

      const result = await getUserCookbooks(testUser.id);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("My Cookbook");
    });

    it("counts only live recipes in recipeCount (not orphans)", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "With Recipe",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");

      const result = await getUserCookbooks(testUser.id);
      expect(result[0].recipeCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // getCookbook
  // --------------------------------------------------------------------------
  describe("getCookbook", () => {
    it("returns the cookbook by id and userId", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Test",
      });

      const result = await getCookbook(cookbook.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(cookbook.id);
    });

    it("returns undefined for a cookbook owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Other",
      });

      const result = await getCookbook(cookbook.id, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns undefined for nonexistent id", async () => {
      const result = await getCookbook(999999, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // updateCookbook
  // --------------------------------------------------------------------------
  describe("updateCookbook", () => {
    it("updates and returns the cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Original Name",
      });

      const updated = await updateCookbook(cookbook.id, testUser.id, {
        name: "Updated Name",
        description: "New description",
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.description).toBe("New description");
    });

    it("returns undefined when cookbook does not belong to user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Other",
      });

      const result = await updateCookbook(cookbook.id, testUser.id, {
        name: "Hacked",
      });
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // deleteCookbook
  // --------------------------------------------------------------------------
  describe("deleteCookbook", () => {
    it("deletes an owned cookbook and returns true", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "To Delete",
      });

      const result = await deleteCookbook(cookbook.id, testUser.id);
      expect(result).toBe(true);

      const check = await getCookbook(cookbook.id, testUser.id);
      expect(check).toBeUndefined();
    });

    it("returns false when cookbook does not belong to user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Other",
      });

      const result = await deleteCookbook(cookbook.id, testUser.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // addRecipeToCookbook
  // --------------------------------------------------------------------------
  describe("addRecipeToCookbook", () => {
    it("adds a mealPlan recipe to a cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const result = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
      );

      expect(result).toBeDefined();
      expect(result!.cookbookId).toBe(cookbook.id);
      expect(result!.recipeId).toBe(recipe.id);
      expect(result!.recipeType).toBe("mealPlan");
    });

    it("adds a community recipe to a cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestCommunityRecipe(testUser.id);

      const result = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "community",
      );

      expect(result).toBeDefined();
      expect(result!.recipeType).toBe("community");
    });

    it("returns undefined on duplicate insert (onConflictDoNothing)", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);

      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");
      const duplicate = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
      );

      expect(duplicate).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // removeRecipeFromCookbook
  // --------------------------------------------------------------------------
  describe("removeRecipeFromCookbook", () => {
    it("removes a recipe and returns true", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");

      const result = await removeRecipeFromCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(true);

      const recipes = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(recipes).toHaveLength(0);
    });

    it("returns false when the recipe is not in the cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const result = await removeRecipeFromCookbook(
        cookbook.id,
        999999,
        "mealPlan",
      );
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getCookbookRecipes
  // --------------------------------------------------------------------------
  describe("getCookbookRecipes", () => {
    it("returns junction rows for the cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe1 = await createTestMealPlanRecipe(testUser.id);
      const recipe2 = await createTestCommunityRecipe(testUser.id);
      await addRecipeToCookbook(cookbook.id, recipe1.id, "mealPlan");
      await addRecipeToCookbook(cookbook.id, recipe2.id, "community");

      const result = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(2);
    });

    it("returns empty array for a cookbook owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Other",
      });
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");

      const result = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getResolvedCookbookRecipes — polymorphic FK orphan cleanup
  // --------------------------------------------------------------------------
  describe("getResolvedCookbookRecipes", () => {
    it("returns empty array when cookbook has no recipes", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Empty Cookbook",
      });

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);
    });

    it("resolves mealPlan recipes with correct shape", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Spaghetti Bolognese",
        description: "Classic pasta",
        servings: 4,
        difficulty: "medium",
      });
      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(1);
      expect(result[0].recipeId).toBe(recipe.id);
      expect(result[0].recipeType).toBe("mealPlan");
      expect(result[0].title).toBe("Spaghetti Bolognese");
      expect(result[0].description).toBe("Classic pasta");
      expect(result[0].servings).toBe(4);
      expect(result[0].difficulty).toBe("medium");
      expect(typeof result[0].addedAt).toBe("string");
    });

    it("resolves community recipes with correct shape", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestCommunityRecipe(testUser.id, {
        title: "Greek Salad",
        description: "Fresh salad",
      });
      await addRecipeToCookbook(cookbook.id, recipe.id, "community");

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(1);
      expect(result[0].recipeType).toBe("community");
      expect(result[0].title).toBe("Greek Salad");
    });

    it("omits orphaned junction rows and triggers fire-and-forget cleanup", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Will Be Deleted",
      });
      await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan");

      // Delete the source recipe to create a polymorphic FK orphan
      const { eq } = await import("drizzle-orm");
      await tx.delete(mealPlanRecipes).where(eq(mealPlanRecipes.id, recipe.id));

      // Resolved list must be empty and must not include the orphan
      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(0);

      // Await the fire-and-forget cleanup
      expect(lastFireAndForgetPromise).not.toBeNull();
      await lastFireAndForgetPromise;

      // Orphan junction row must have been removed
      const remaining = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(remaining).toHaveLength(0);
    });

    it("resolves mixed mealPlan and community recipes, omitting only orphaned ones", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mixed Cookbook",
      });
      const mpRecipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Surviving MealPlan Recipe",
      });
      const orphanMpRecipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Orphaned MealPlan Recipe",
      });
      const commRecipe = await createTestCommunityRecipe(testUser.id, {
        title: "Community Recipe",
      });
      await addRecipeToCookbook(cookbook.id, mpRecipe.id, "mealPlan");
      await addRecipeToCookbook(cookbook.id, orphanMpRecipe.id, "mealPlan");
      await addRecipeToCookbook(cookbook.id, commRecipe.id, "community");

      // Delete one mealPlan recipe to create an orphan
      const { eq } = await import("drizzle-orm");
      await tx
        .delete(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, orphanMpRecipe.id));

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      // Only the 2 surviving recipes should be resolved
      expect(result).toHaveLength(2);
      const titles = result.map((r) => r.title);
      expect(titles).toContain("Surviving MealPlan Recipe");
      expect(titles).toContain("Community Recipe");

      // Await orphan cleanup
      await lastFireAndForgetPromise;

      const remaining = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(remaining).toHaveLength(2);
    });
  });
});
