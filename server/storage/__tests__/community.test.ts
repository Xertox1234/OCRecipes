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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getDailyRecipeGenerationCount,
  logRecipeGeneration,
  getCommunityRecipes,
  createCommunityRecipe,
  updateRecipePublicStatus,
  getCommunityRecipe,
  getFeaturedRecipes,
  deleteCommunityRecipe,
  getUserRecipes,
} = await import("../community");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Insert a community recipe with sensible defaults. */
async function createTestRecipe(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const defaults = {
    authorId: userId,
    title: "Test Recipe",
    description: "Test description",
    // `test-` prefix: ensures global-teardown / cleanup-seed-recipes
    // catches any row that leaks past transaction rollback. See
    // `server/scripts/cleanup-seed-recipes-utils.ts`.
    normalizedProductName: "test-food",
    instructions: ["Mix and bake"],
    isPublic: true,
  };
  return createCommunityRecipe({ ...defaults, ...overrides });
}

describe("community storage", () => {
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
  // getDailyRecipeGenerationCount
  // --------------------------------------------------------------------------
  describe("getDailyRecipeGenerationCount", () => {
    it("returns 0 when no generations exist for the day", async () => {
      const count = await getDailyRecipeGenerationCount(
        testUser.id,
        new Date(),
      );
      expect(count).toBe(0);
    });

    it("returns correct count after logging generations", async () => {
      const recipe = await createTestRecipe(testUser.id);
      await logRecipeGeneration(testUser.id, recipe.id);
      await logRecipeGeneration(testUser.id, recipe.id);

      const count = await getDailyRecipeGenerationCount(
        testUser.id,
        new Date(),
      );
      expect(count).toBe(2);
    });

    it("does not count generations from a different day", async () => {
      const recipe = await createTestRecipe(testUser.id);
      await logRecipeGeneration(testUser.id, recipe.id);

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const count = await getDailyRecipeGenerationCount(testUser.id, yesterday);
      expect(count).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // logRecipeGeneration
  // --------------------------------------------------------------------------
  describe("logRecipeGeneration", () => {
    it("inserts a generation log entry", async () => {
      const recipe = await createTestRecipe(testUser.id);
      await logRecipeGeneration(testUser.id, recipe.id);

      const count = await getDailyRecipeGenerationCount(
        testUser.id,
        new Date(),
      );
      expect(count).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // getCommunityRecipes
  // --------------------------------------------------------------------------
  describe("getCommunityRecipes", () => {
    it("finds public recipes by exact barcode match", async () => {
      await createTestRecipe(testUser.id, {
        barcode: "1234567890",
        normalizedProductName: "test-granola bar",
      });

      const results = await getCommunityRecipes("1234567890", "something else");
      expect(results).toHaveLength(1);
      expect(results[0].barcode).toBe("1234567890");
    });

    it("finds public recipes by product name (no barcode)", async () => {
      await createTestRecipe(testUser.id, {
        normalizedProductName: "test-oat milk",
      });

      // ILIKE %oat milk% still matches "test-oat milk"
      const results = await getCommunityRecipes(null, "oat milk");
      expect(results).toHaveLength(1);
      expect(results[0].normalizedProductName).toBe("test-oat milk");
    });

    it("finds recipes by barcode OR name when barcode is provided", async () => {
      await createTestRecipe(testUser.id, {
        title: "By Barcode",
        barcode: "AAA111",
        normalizedProductName: "test-unrelated product",
      });
      await createTestRecipe(testUser.id, {
        title: "By Name",
        barcode: null,
        normalizedProductName: "test-chocolate chip cookies",
      });

      const results = await getCommunityRecipes("AAA111", "chocolate chip");
      expect(results).toHaveLength(2);
    });

    it("does not return private recipes", async () => {
      await createTestRecipe(testUser.id, {
        barcode: "PRIVATE1",
        normalizedProductName: "test-secret food",
        isPublic: false,
      });

      const results = await getCommunityRecipes("PRIVATE1", "secret food");
      expect(results).toHaveLength(0);
    });

    it("performs case-insensitive name matching", async () => {
      await createTestRecipe(testUser.id, {
        normalizedProductName: "test-Peanut Butter",
      });

      const results = await getCommunityRecipes(null, "peanut butter");
      expect(results).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // createCommunityRecipe
  // --------------------------------------------------------------------------
  describe("createCommunityRecipe", () => {
    it("creates a recipe and returns it with an id", async () => {
      const recipe = await createCommunityRecipe({
        authorId: testUser.id,
        title: "My New Recipe",
        description: "Delicious",
        normalizedProductName: "test-pasta",
        instructions: ["Boil then serve"],
        isPublic: true,
        dietTags: ["vegan"],
      });

      expect(recipe.id).toBeDefined();
      expect(recipe.title).toBe("My New Recipe");
      expect(recipe.authorId).toBe(testUser.id);
      expect(recipe.normalizedProductName).toBe("test-pasta");
      expect(recipe.dietTags).toEqual(["vegan"]);
      expect(recipe.createdAt).toBeInstanceOf(Date);
    });
  });

  // --------------------------------------------------------------------------
  // updateRecipePublicStatus
  // --------------------------------------------------------------------------
  describe("updateRecipePublicStatus", () => {
    it("updates the public status for the recipe author", async () => {
      const recipe = await createTestRecipe(testUser.id, { isPublic: true });

      const updated = await updateRecipePublicStatus(
        recipe.id,
        testUser.id,
        false,
      );
      expect(updated).toBeDefined();
      expect(updated!.isPublic).toBe(false);
    });

    it("returns undefined when a different user tries to update (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestRecipe(testUser.id, { isPublic: true });

      const result = await updateRecipePublicStatus(
        recipe.id,
        otherUser.id,
        false,
      );
      expect(result).toBeUndefined();

      // Original recipe should remain unchanged
      const original = await getCommunityRecipe(recipe.id);
      expect(original!.isPublic).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // getCommunityRecipe
  // --------------------------------------------------------------------------
  describe("getCommunityRecipe", () => {
    it("returns the recipe when it exists", async () => {
      const created = await createTestRecipe(testUser.id, {
        title: "Find Me",
      });

      const found = await getCommunityRecipe(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Find Me");
    });

    it("returns undefined when recipe does not exist", async () => {
      const found = await getCommunityRecipe(999999);
      expect(found).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getFeaturedRecipes
  // --------------------------------------------------------------------------
  describe("getFeaturedRecipes", () => {
    it("returns only public recipes", async () => {
      await createTestRecipe(testUser.id, {
        title: "PublicTestUnique",
        isPublic: true,
      });
      await createTestRecipe(testUser.id, {
        title: "PrivateTestUnique",
        isPublic: false,
      });

      // Use a large limit to get all
      const featured = await getFeaturedRecipes(1000, 0);
      // Our public recipe should be included exactly once
      expect(
        featured.filter((r) => r.title === "PublicTestUnique"),
      ).toHaveLength(1);
      // Our private recipe should not be included
      expect(
        featured.filter((r) => r.title === "PrivateTestUnique"),
      ).toHaveLength(0);
      // All returned recipes should be public (verified by query's where clause)
    });

    it("respects limit parameter", async () => {
      // Create 3 public recipes
      for (let i = 0; i < 3; i++) {
        await createTestRecipe(testUser.id, {
          title: `LimitTest_${i}`,
          isPublic: true,
        });
      }

      const limited = await getFeaturedRecipes(2, 0);
      expect(limited).toHaveLength(2);

      // Get all (with large limit) and verify more exist
      const all = await getFeaturedRecipes(1000, 0);
      expect(all.length).toBeGreaterThan(2);
    });
  });

  // --------------------------------------------------------------------------
  // deleteCommunityRecipe
  // --------------------------------------------------------------------------
  describe("deleteCommunityRecipe", () => {
    it("deletes a recipe owned by the user and returns true", async () => {
      const recipe = await createTestRecipe(testUser.id);

      const deleted = await deleteCommunityRecipe(recipe.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getCommunityRecipe(recipe.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createTestRecipe(testUser.id);

      const deleted = await deleteCommunityRecipe(recipe.id, otherUser.id);
      expect(deleted).toBe(false);

      // Recipe should still exist
      const found = await getCommunityRecipe(recipe.id);
      expect(found).toBeDefined();
    });

    it("returns false when recipe does not exist", async () => {
      const deleted = await deleteCommunityRecipe(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getUserRecipes
  // --------------------------------------------------------------------------
  describe("getUserRecipes", () => {
    it("returns items and total count for the user", async () => {
      await createTestRecipe(testUser.id, { title: "A" });
      await createTestRecipe(testUser.id, { title: "B" });
      await createTestRecipe(testUser.id, { title: "C" });

      const { items, total } = await getUserRecipes(testUser.id);
      expect(items).toHaveLength(3);
      expect(total).toBe(3);
    });

    it("does not include recipes from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createTestRecipe(testUser.id, { title: "Mine" });
      await createTestRecipe(otherUser.id, { title: "Theirs" });

      const { items, total } = await getUserRecipes(testUser.id);
      expect(items).toHaveLength(1);
      expect(total).toBe(1);
      expect(items[0].title).toBe("Mine");
    });

    it("respects limit and offset and reports correct total", async () => {
      for (let i = 0; i < 5; i++) {
        await createTestRecipe(testUser.id, { title: `Recipe ${i}` });
      }

      const { items, total } = await getUserRecipes(testUser.id, 2, 0);
      expect(items).toHaveLength(2);
      expect(total).toBe(5);

      const page2 = await getUserRecipes(testUser.id, 2, 2);
      expect(page2.items).toHaveLength(2);
      expect(page2.total).toBe(5);
    });
  });
});
