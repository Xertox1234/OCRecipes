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
  cookbooks,
  scannedItems,
  groceryLists,
  pantryItems,
  communityRecipes,
  favouriteRecipes,
} from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const { getLibraryCounts } = await import("../profile-hub");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("profile-hub storage", () => {
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
  // getLibraryCounts
  // --------------------------------------------------------------------------
  describe("getLibraryCounts", () => {
    it("returns zeroes for a new user with no data", async () => {
      const result = await getLibraryCounts(testUser.id);

      expect(result.cookbooks).toBe(0);
      expect(result.savedItems).toBe(0);
      expect(result.scanHistory).toBe(0);
      expect(result.groceryLists).toBe(0);
      expect(result.pantryItems).toBe(0);
      expect(result.favouriteRecipes).toBe(0);
      // featuredRecipes may be > 0 due to seeded data or cached; just check it's a number
      expect(typeof result.featuredRecipes).toBe("number");
      expect(result.featuredRecipes).toBeGreaterThanOrEqual(0);
    });

    it("counts cookbooks for the user", async () => {
      await tx
        .insert(cookbooks)
        .values({ userId: testUser.id, name: "My Cookbook" });

      const result = await getLibraryCounts(testUser.id);
      expect(result.cookbooks).toBe(1);
    });

    it("counts non-discarded scan history items", async () => {
      await tx.insert(scannedItems).values({
        userId: testUser.id,
        productName: "Apple",
        calories: "95",
        protein: "0",
        carbs: "25",
        fat: "0",
        sourceType: "scan",
      });
      // Discarded item should not be counted
      await tx.insert(scannedItems).values({
        userId: testUser.id,
        productName: "Discarded Item",
        calories: "0",
        protein: "0",
        carbs: "0",
        fat: "0",
        sourceType: "scan",
        discardedAt: new Date(),
      });

      const result = await getLibraryCounts(testUser.id);
      expect(result.scanHistory).toBe(1);
    });

    it("counts grocery lists for the user", async () => {
      await tx.insert(groceryLists).values({
        userId: testUser.id,
        title: "Weekend Shopping",
        dateRangeStart: "2025-06-01",
        dateRangeEnd: "2025-06-07",
      });

      const result = await getLibraryCounts(testUser.id);
      expect(result.groceryLists).toBe(1);
    });

    it("counts pantry items for the user", async () => {
      await tx.insert(pantryItems).values({
        userId: testUser.id,
        name: "Olive Oil",
        category: "oils",
      });

      const result = await getLibraryCounts(testUser.id);
      expect(result.pantryItems).toBe(1);
    });

    it("counts favourite recipes for the user", async () => {
      // Create a community recipe and favourite it
      const [recipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          title: "Favourite Recipe",
          normalizedProductName: "test-favourite-recipe",
          instructions: ["Step 1"],
        })
        .returning();

      await tx.insert(favouriteRecipes).values({
        userId: testUser.id,
        recipeId: recipe.id,
        recipeType: "community",
      });

      const result = await getLibraryCounts(testUser.id);
      expect(result.favouriteRecipes).toBe(1);
    });

    it("does not include counts from other users", async () => {
      const otherUser = await createTestUser(tx);
      await tx
        .insert(cookbooks)
        .values({ userId: otherUser.id, name: "Other Cookbook" });

      const result = await getLibraryCounts(testUser.id);
      expect(result.cookbooks).toBe(0);
    });
  });
});
