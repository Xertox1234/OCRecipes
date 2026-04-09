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
import { mealPlanRecipes, communityRecipes, users } from "@shared/schema";

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
  toggleFavouriteRecipe,
  getUserFavouriteRecipeIds,
  isRecipeFavourited,
  getFavouriteRecipeCount,
  getResolvedFavouriteRecipes,
  getRecipeSharePayload,
} = await import("../favourite-recipes");

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
      normalizedProductName: "test product",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("favourite-recipes storage", () => {
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
  // toggleFavouriteRecipe
  // --------------------------------------------------------------------------
  describe("toggleFavouriteRecipe", () => {
    it("returns true when adding a mealPlan recipe as favourite", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      const result = await toggleFavouriteRecipe(
        testUser.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(true);
    });

    it("returns false when removing an existing favourite", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await toggleFavouriteRecipe(testUser.id, recipe.id, "mealPlan");
      const result = await toggleFavouriteRecipe(
        testUser.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(false);
    });

    it("returns true when adding a community recipe as favourite", async () => {
      const recipe = await createTestCommunityRecipe(testUser.id);
      const result = await toggleFavouriteRecipe(
        testUser.id,
        recipe.id,
        "community",
      );
      expect(result).toBe(true);
    });

    it("returns false for nonexistent mealPlan recipe", async () => {
      const result = await toggleFavouriteRecipe(
        testUser.id,
        999999,
        "mealPlan",
      );
      expect(result).toBe(false);
    });

    it("returns false for nonexistent community recipe", async () => {
      const result = await toggleFavouriteRecipe(
        testUser.id,
        999999,
        "community",
      );
      expect(result).toBe(false);
    });

    it("returns false for mealPlan recipe not owned by user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      const result = await toggleFavouriteRecipe(
        testUser.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(false);
    });

    it("returns null when limit is reached for free tier", async () => {
      // Free tier limit is 20
      const recipes: schema.MealPlanRecipe[] = [];
      for (let i = 0; i < 20; i++) {
        recipes.push(
          await createTestMealPlanRecipe(testUser.id, {
            title: `Recipe ${i}`,
          }),
        );
      }

      // Add 20 favourites to hit the limit
      for (const recipe of recipes) {
        const result = await toggleFavouriteRecipe(
          testUser.id,
          recipe.id,
          "mealPlan",
        );
        expect(result).toBe(true);
      }

      // 21st should return null (limit reached)
      const extraRecipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Extra Recipe",
      });
      const result = await toggleFavouriteRecipe(
        testUser.id,
        extraRecipe.id,
        "mealPlan",
      );
      expect(result).toBe(null);
    });

    it("allows unlimited favourites for premium tier", async () => {
      // Update user to premium
      const { eq } = await import("drizzle-orm");
      await tx
        .update(users)
        .set({ subscriptionTier: "premium" })
        .where(eq(users.id, testUser.id));

      // Create 21 recipes and favourite all of them
      for (let i = 0; i < 21; i++) {
        const recipe = await createTestMealPlanRecipe(testUser.id, {
          title: `Premium Recipe ${i}`,
        });
        const result = await toggleFavouriteRecipe(
          testUser.id,
          recipe.id,
          "mealPlan",
        );
        expect(result).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // getUserFavouriteRecipeIds
  // --------------------------------------------------------------------------
  describe("getUserFavouriteRecipeIds", () => {
    it("returns empty array when no favourites", async () => {
      const ids = await getUserFavouriteRecipeIds(testUser.id);
      expect(ids).toEqual([]);
    });

    it("returns all favourite IDs for the user", async () => {
      const recipe1 = await createTestMealPlanRecipe(testUser.id);
      const recipe2 = await createTestCommunityRecipe(testUser.id);
      await toggleFavouriteRecipe(testUser.id, recipe1.id, "mealPlan");
      await toggleFavouriteRecipe(testUser.id, recipe2.id, "community");

      const ids = await getUserFavouriteRecipeIds(testUser.id);
      expect(ids).toHaveLength(2);
      expect(ids).toEqual(
        expect.arrayContaining([
          { recipeId: recipe1.id, recipeType: "mealPlan" },
          { recipeId: recipe2.id, recipeType: "community" },
        ]),
      );
    });
  });

  // --------------------------------------------------------------------------
  // isRecipeFavourited
  // --------------------------------------------------------------------------
  describe("isRecipeFavourited", () => {
    it("returns false when not favourited", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      const result = await isRecipeFavourited(
        testUser.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(false);
    });

    it("returns true when favourited", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await toggleFavouriteRecipe(testUser.id, recipe.id, "mealPlan");
      const result = await isRecipeFavourited(
        testUser.id,
        recipe.id,
        "mealPlan",
      );
      expect(result).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // getFavouriteRecipeCount
  // --------------------------------------------------------------------------
  describe("getFavouriteRecipeCount", () => {
    it("returns 0 when no favourites", async () => {
      const count = await getFavouriteRecipeCount(testUser.id);
      expect(count).toBe(0);
    });

    it("returns correct count", async () => {
      const recipe1 = await createTestMealPlanRecipe(testUser.id);
      const recipe2 = await createTestCommunityRecipe(testUser.id);
      await toggleFavouriteRecipe(testUser.id, recipe1.id, "mealPlan");
      await toggleFavouriteRecipe(testUser.id, recipe2.id, "community");
      const count = await getFavouriteRecipeCount(testUser.id);
      expect(count).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // getResolvedFavouriteRecipes — orphan cleanup
  // --------------------------------------------------------------------------
  describe("getResolvedFavouriteRecipes", () => {
    it("returns empty array when no favourites", async () => {
      const result = await getResolvedFavouriteRecipes(testUser.id);
      expect(result).toEqual([]);
    });

    it("resolves mealPlan and community recipes", async () => {
      const mpRecipe = await createTestMealPlanRecipe(testUser.id, {
        title: "My Pasta",
        description: "Tasty pasta",
      });
      const cRecipe = await createTestCommunityRecipe(testUser.id, {
        title: "Community Salad",
        description: "Fresh salad",
      });
      await toggleFavouriteRecipe(testUser.id, mpRecipe.id, "mealPlan");
      await toggleFavouriteRecipe(testUser.id, cRecipe.id, "community");

      const result = await getResolvedFavouriteRecipes(testUser.id);
      expect(result).toHaveLength(2);
      const titles = result.map((r) => r.title);
      expect(titles).toContain("My Pasta");
      expect(titles).toContain("Community Salad");
    });

    it("cleans up orphan favourites when recipe is deleted", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await toggleFavouriteRecipe(testUser.id, recipe.id, "mealPlan");

      // Delete the recipe directly to create an orphan
      const { eq } = await import("drizzle-orm");
      await tx.delete(mealPlanRecipes).where(eq(mealPlanRecipes.id, recipe.id));

      // Resolving should detect the orphan and clean it up
      const result = await getResolvedFavouriteRecipes(testUser.id);
      expect(result).toHaveLength(0);

      // Await the fire-and-forget orphan cleanup
      await lastFireAndForgetPromise;

      // Confirm orphan was cleaned up
      const count = await getFavouriteRecipeCount(testUser.id);
      expect(count).toBe(0);
    });

    it("respects limit parameter", async () => {
      // Create 3 recipes and favourite all
      for (let i = 0; i < 3; i++) {
        const recipe = await createTestMealPlanRecipe(testUser.id, {
          title: `Recipe ${i}`,
        });
        await toggleFavouriteRecipe(testUser.id, recipe.id, "mealPlan");
      }

      const result = await getResolvedFavouriteRecipes(testUser.id, 2);
      expect(result).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getRecipeSharePayload — access control
  // --------------------------------------------------------------------------
  describe("getRecipeSharePayload", () => {
    it("returns payload for owned mealPlan recipe", async () => {
      const recipe = await createTestMealPlanRecipe(testUser.id, {
        title: "Sharable Recipe",
        description: "A great recipe",
      });
      const payload = await getRecipeSharePayload(
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(payload).not.toBeNull();
      expect(payload!.title).toBe("Sharable Recipe");
    });

    it("returns null for mealPlan recipe not owned by user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      const payload = await getRecipeSharePayload(
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(payload).toBeNull();
    });

    it("returns payload for public community recipe", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestCommunityRecipe(otherUser.id, {
        isPublic: true,
        title: "Public Recipe",
        description: "Public desc",
      });
      const payload = await getRecipeSharePayload(
        recipe.id,
        "community",
        testUser.id,
      );
      expect(payload).not.toBeNull();
      expect(payload!.title).toBe("Public Recipe");
    });

    it("returns null for private community recipe not owned by user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestCommunityRecipe(otherUser.id, {
        isPublic: false,
      });
      const payload = await getRecipeSharePayload(
        recipe.id,
        "community",
        testUser.id,
      );
      expect(payload).toBeNull();
    });

    it("returns payload for own private community recipe", async () => {
      const recipe = await createTestCommunityRecipe(testUser.id, {
        isPublic: false,
        title: "My Private Recipe",
      });
      const payload = await getRecipeSharePayload(
        recipe.id,
        "community",
        testUser.id,
      );
      expect(payload).not.toBeNull();
      expect(payload!.title).toBe("My Private Recipe");
    });

    it("returns null for nonexistent recipe", async () => {
      const payload = await getRecipeSharePayload(
        999999,
        "mealPlan",
        testUser.id,
      );
      expect(payload).toBeNull();
    });
  });
});
