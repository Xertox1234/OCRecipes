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
  savedItems,
  scannedItems,
  groceryLists,
  pantryItems,
  communityRecipes,
  favouriteRecipes,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("profile-hub storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    // profile-hub has a module-level featuredRecipes cache. Reset modules so
    // each test gets a fresh cache and we never depend on test ordering.
    vi.resetModules();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("getLibraryCounts", () => {
    it("returns zero per-user counts for a user with no library data", async () => {
      const { getLibraryCounts } = await import("../profile-hub");
      const counts = await getLibraryCounts(testUser.id);
      // featuredRecipes is a *global* count, not per-user — don't assert on it.
      expect(counts.cookbooks).toBe(0);
      expect(counts.savedItems).toBe(0);
      expect(counts.scanHistory).toBe(0);
      expect(counts.groceryLists).toBe(0);
      expect(counts.pantryItems).toBe(0);
      expect(counts.favouriteRecipes).toBe(0);
      expect(counts.featuredRecipes).toBeGreaterThanOrEqual(0);
    });

    it("counts each library section correctly", async () => {
      const { getLibraryCounts } = await import("../profile-hub");

      await tx.insert(cookbooks).values({
        userId: testUser.id,
        name: "My Cookbook",
      });
      await tx.insert(savedItems).values({
        userId: testUser.id,
        type: "recipe",
        title: "Saved Apple Recipe",
      });
      await tx.insert(scannedItems).values({
        userId: testUser.id,
        productName: "Banana",
      });
      // A discarded scanned item should be excluded from scanHistory count.
      await tx.insert(scannedItems).values({
        userId: testUser.id,
        productName: "Discarded Banana",
        discardedAt: new Date(),
      });
      await tx.insert(groceryLists).values({
        userId: testUser.id,
        title: "Weekly",
        dateRangeStart: "2026-05-15",
        dateRangeEnd: "2026-05-22",
      });
      await tx.insert(pantryItems).values({
        userId: testUser.id,
        name: "Salt",
      });

      const [publicRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: "test-public-recipe",
          title: "Public Recipe",
          instructions: ["Step 1"],
          isPublic: true,
        })
        .returning();

      await tx.insert(favouriteRecipes).values({
        userId: testUser.id,
        recipeId: publicRecipe.id,
        recipeType: "community",
      });

      const counts = await getLibraryCounts(testUser.id);
      expect(counts.cookbooks).toBe(1);
      expect(counts.savedItems).toBe(1);
      expect(counts.scanHistory).toBe(1); // discarded one excluded
      expect(counts.groceryLists).toBe(1);
      expect(counts.pantryItems).toBe(1);
      expect(counts.featuredRecipes).toBeGreaterThanOrEqual(1);
      expect(counts.favouriteRecipes).toBe(1);
    });

    it("scopes per-user counts — other users' rows are excluded", async () => {
      const { getLibraryCounts } = await import("../profile-hub");

      const otherUser = await createTestUser(tx);
      await tx.insert(cookbooks).values({
        userId: otherUser.id,
        name: "Other User Cookbook",
      });

      const counts = await getLibraryCounts(testUser.id);
      expect(counts.cookbooks).toBe(0);
    });

    it("serves featuredRecipes from cache on the second call within TTL", async () => {
      // Single fresh module instance for this test (beforeEach already
      // reset modules), so the cache starts empty.
      const { getLibraryCounts } = await import("../profile-hub");

      // First call populates the cache.
      await tx.insert(communityRecipes).values({
        authorId: testUser.id,
        normalizedProductName: "test-cached-recipe-1",
        title: "Cached A",
        instructions: ["Step 1"],
        isPublic: true,
      });
      const first = await getLibraryCounts(testUser.id);
      const firstFeatured = first.featuredRecipes;
      expect(firstFeatured).toBeGreaterThanOrEqual(1);

      // Insert another public recipe — cache should still report the prior
      // count because the second call hits the cached value.
      await tx.insert(communityRecipes).values({
        authorId: testUser.id,
        normalizedProductName: "test-cached-recipe-2",
        title: "Cached B",
        instructions: ["Step 1"],
        isPublic: true,
      });
      const second = await getLibraryCounts(testUser.id);
      expect(second.featuredRecipes).toBe(firstFeatured);
    });
  });
});
