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
  cookbookRecipes,
  cookbooks as cookbooksTable,
  mealPlanRecipes,
  communityRecipes,
} from "@shared/schema";

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
      // `test-` prefix matches cleanup-seed-recipes-utils.ts safety net.
      normalizedProductName: `test-product-${crypto.randomUUID().slice(0, 8)}`,
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
    it("creates a cookbook with required fields", async () => {
      const result = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      expect(result.id).toBeGreaterThan(0);
      expect(result.name).toBe("My Cookbook");
      expect(result.userId).toBe(testUser.id);
      expect(result.description).toBeNull();
    });

    it("creates a cookbook with description and cover image", async () => {
      const result = await createCookbook({
        userId: testUser.id,
        name: "Italian Favourites",
        description: "Best pasta recipes",
        coverImageUrl: "https://example.com/cover.jpg",
      });
      expect(result.description).toBe("Best pasta recipes");
      expect(result.coverImageUrl).toBe("https://example.com/cover.jpg");
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

    it("returns cookbooks owned by user with recipe counts", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "My Cookbook",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      const result = await getUserCookbooks(testUser.id);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(cookbook.id);
      expect(result[0].recipeCount).toBe(1);
    });

    it("does not return cookbooks owned by other users", async () => {
      const otherUser = await createTestUser(tx);
      await createCookbook({ userId: otherUser.id, name: "Other Cookbook" });

      const result = await getUserCookbooks(testUser.id);
      expect(result).toEqual([]);
    });

    it("counts recipes per type and excludes orphan junction rows", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mixed",
      });
      const mpRecipe = await createTestMealPlanRecipe(testUser.id);
      const cRecipe = await createTestCommunityRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        mpRecipe.id,
        "mealPlan",
        testUser.id,
      );
      await addRecipeToCookbook(
        cookbook.id,
        cRecipe.id,
        "community",
        testUser.id,
      );

      // Delete the meal-plan recipe; junction row remains as orphan.
      const { eq } = await import("drizzle-orm");
      await tx
        .delete(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, mpRecipe.id));

      const result = await getUserCookbooks(testUser.id);
      // recipeCount should reflect only live recipes (1), not orphan junction rows (2).
      expect(result[0].recipeCount).toBe(1);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 3; i++) {
        await createCookbook({
          userId: testUser.id,
          name: `Cookbook ${i}`,
        });
      }
      const result = await getUserCookbooks(testUser.id, 2);
      expect(result).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getCookbook
  // --------------------------------------------------------------------------
  describe("getCookbook", () => {
    it("returns cookbook when owned by user", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mine",
      });
      const result = await getCookbook(cookbook.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(cookbook.id);
    });

    it("returns undefined when cookbook not found", async () => {
      const result = await getCookbook(999999, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns undefined when cookbook owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const result = await getCookbook(cookbook.id, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // updateCookbook
  // --------------------------------------------------------------------------
  describe("updateCookbook", () => {
    it("updates name and description when owned by user", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Old Name",
      });
      const result = await updateCookbook(cookbook.id, testUser.id, {
        name: "New Name",
        description: "Updated desc",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("New Name");
      expect(result!.description).toBe("Updated desc");
    });

    it("returns undefined when updating cookbook owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const result = await updateCookbook(cookbook.id, testUser.id, {
        name: "Hijacked",
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when cookbook does not exist", async () => {
      const result = await updateCookbook(999999, testUser.id, {
        name: "Nope",
      });
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // deleteCookbook
  // --------------------------------------------------------------------------
  describe("deleteCookbook", () => {
    it("returns true when cookbook is deleted", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "ToDelete",
      });
      const result = await deleteCookbook(cookbook.id, testUser.id);
      expect(result).toBe(true);

      const after = await getCookbook(cookbook.id, testUser.id);
      expect(after).toBeUndefined();
    });

    it("returns false when cookbook owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const result = await deleteCookbook(cookbook.id, testUser.id);
      expect(result).toBe(false);

      // Confirm the cookbook still exists for the owner
      const stillThere = await getCookbook(cookbook.id, otherUser.id);
      expect(stillThere).toBeDefined();
    });

    it("returns false for nonexistent cookbook", async () => {
      const result = await deleteCookbook(999999, testUser.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // addRecipeToCookbook / removeRecipeFromCookbook
  //
  // Both mutations enforce ownership at the storage layer (defense-in-depth)
  // by guarding the write with a `WHERE EXISTS / cookbooks.user_id` check in
  // the same statement. Route handlers still pre-verify ownership with
  // `getCookbook(id, userId)`, so the storage guard is a backstop — these
  // tests cover happy-path + duplicate / missing-recipe / cross-user IDOR.
  // --------------------------------------------------------------------------
  describe("addRecipeToCookbook", () => {
    it("adds a mealPlan recipe and bumps updatedAt", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);

      // Capture original updatedAt, then sleep so CURRENT_TIMESTAMP advances.
      // (Postgres CURRENT_TIMESTAMP is fixed per statement, so an UPDATE inside
      // a separate later statement will produce a strictly greater value.)
      const original = (await getCookbook(cookbook.id, testUser.id))!;

      const added = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(added).toBeDefined();
      expect(added!.recipeId).toBe(recipe.id);
      expect(added!.recipeType).toBe("mealPlan");

      const after = (await getCookbook(cookbook.id, testUser.id))!;
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        original.updatedAt.getTime(),
      );
    });

    it("adds a community recipe", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestCommunityRecipe(testUser.id);

      const added = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "community",
        testUser.id,
      );
      expect(added).toBeDefined();
      expect(added!.recipeType).toBe("community");
    });

    it("returns undefined on duplicate insert (idempotent)", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);

      const first = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(first).toBeDefined();

      const second = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(second).toBeUndefined();
    });

    it("returns undefined and does not insert when caller does not own the cookbook (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);

      // Attempt to add a recipe to a cookbook owned by `otherUser` while
      // authenticated as `testUser`.
      const result = await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBeUndefined();

      // No junction row should have been created — the legitimate owner sees
      // an empty cookbook.
      const rows = await getCookbookRecipes(cookbook.id, otherUser.id);
      expect(rows).toEqual([]);
    });

    it("returns undefined when the target mealPlan recipe belongs to another user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mine",
      });
      // A meal-plan recipe owned by someone else — must not be cookbook-able.
      const foreignRecipe = await createTestMealPlanRecipe(otherUser.id);

      const result = await addRecipeToCookbook(
        cookbook.id,
        foreignRecipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBeUndefined();

      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toEqual([]);
    });

    it("returns undefined when the target community recipe is private (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mine",
      });
      const privateRecipe = await createTestCommunityRecipe(otherUser.id, {
        isPublic: false,
      });

      const result = await addRecipeToCookbook(
        cookbook.id,
        privateRecipe.id,
        "community",
        testUser.id,
      );
      expect(result).toBeUndefined();

      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toEqual([]);
    });

    it("returns undefined when the target recipe does not exist", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "Mine",
      });
      const result = await addRecipeToCookbook(
        cookbook.id,
        999999,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // removeRecipeFromCookbook
  // --------------------------------------------------------------------------
  describe("removeRecipeFromCookbook", () => {
    it("removes an existing recipe and returns true", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      const result = await removeRecipeFromCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBe(true);

      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toHaveLength(0);
    });

    it("returns false when recipe not in cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const result = await removeRecipeFromCookbook(
        cookbook.id,
        999999,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBe(false);
    });

    it("does not remove a row with different recipeType", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      // Caller asks to remove with the wrong recipeType.
      const result = await removeRecipeFromCookbook(
        cookbook.id,
        recipe.id,
        "community",
        testUser.id,
      );
      expect(result).toBe(false);

      // Original row is untouched.
      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toHaveLength(1);
    });

    it("returns false and does not delete when caller does not own the cookbook (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        otherUser.id,
      );

      // Attempt to remove the recipe while authenticated as `testUser`.
      const result = await removeRecipeFromCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );
      expect(result).toBe(false);

      // The original junction row must still be present for the legitimate owner.
      const rows = await getCookbookRecipes(cookbook.id, otherUser.id);
      expect(rows).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // getCookbookRecipes
  // --------------------------------------------------------------------------
  describe("getCookbookRecipes", () => {
    it("returns empty when cookbook has no recipes", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toEqual([]);
    });

    it("returns recipes for the cookbook scoped to the owning user", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const mp = await createTestMealPlanRecipe(testUser.id);
      const c = await createTestCommunityRecipe(testUser.id);
      await addRecipeToCookbook(cookbook.id, mp.id, "mealPlan", testUser.id);
      await addRecipeToCookbook(cookbook.id, c.id, "community", testUser.id);

      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toHaveLength(2);
      const pairs = rows.map((r) => `${r.recipeType}:${r.recipeId}`);
      expect(pairs).toEqual(
        expect.arrayContaining([`mealPlan:${mp.id}`, `community:${c.id}`]),
      );
    });

    it("returns empty when caller does not own the cookbook", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        otherUser.id,
      );

      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // getResolvedCookbookRecipes — orphan cleanup is the headline test
  // --------------------------------------------------------------------------
  describe("getResolvedCookbookRecipes", () => {
    it("returns empty array when cookbook has no recipes", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);
    });

    it("returns empty array when caller does not own the cookbook (IDOR)", async () => {
      // The underlying `getCookbookRecipes` innerJoins through `cookbooks` and
      // filters by `cookbooks.userId`, so a non-owner gets zero junction rows
      // and therefore zero resolved recipes — even when rows exist for the owner.
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: otherUser.id,
        name: "Theirs",
      });
      const recipe = await createTestMealPlanRecipe(otherUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        otherUser.id,
      );

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);
    });

    it("resolves both mealPlan and community recipes with display fields", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const mp = await createTestMealPlanRecipe(testUser.id, {
        title: "My Pasta",
        description: "Tasty pasta",
        imageUrl: "https://example.com/mp.jpg",
        servings: 4,
        difficulty: "easy",
      });
      const c = await createTestCommunityRecipe(testUser.id, {
        title: "Community Salad",
        description: "Fresh salad",
        imageUrl: "https://example.com/c.jpg",
        servings: 2,
        difficulty: "medium",
      });
      await addRecipeToCookbook(cookbook.id, mp.id, "mealPlan", testUser.id);
      await addRecipeToCookbook(cookbook.id, c.id, "community", testUser.id);

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toHaveLength(2);

      const byTitle = new Map(result.map((r) => [r.title, r]));
      expect(byTitle.get("My Pasta")?.recipeType).toBe("mealPlan");
      expect(byTitle.get("My Pasta")?.imageUrl).toBe(
        "https://example.com/mp.jpg",
      );
      expect(byTitle.get("Community Salad")?.recipeType).toBe("community");
      expect(byTitle.get("Community Salad")?.servings).toBe(2);
    });

    it("omits orphaned mealPlan junction rows and fires cleanup", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      // Delete the underlying recipe to create an orphan junction row.
      const { eq } = await import("drizzle-orm");
      await tx.delete(mealPlanRecipes).where(eq(mealPlanRecipes.id, recipe.id));

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);

      // Await the fire-and-forget orphan cleanup
      expect(lastFireAndForgetPromise).not.toBeNull();
      await lastFireAndForgetPromise;

      // The orphan junction row should now be gone.
      const remaining = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(remaining).toEqual([]);
    });

    it("omits orphaned community junction rows and fires cleanup", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestCommunityRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "community",
        testUser.id,
      );

      const { eq } = await import("drizzle-orm");
      await tx
        .delete(communityRecipes)
        .where(eq(communityRecipes.id, recipe.id));

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);

      expect(lastFireAndForgetPromise).not.toBeNull();
      await lastFireAndForgetPromise;

      const remaining = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(remaining).toEqual([]);
    });

    it("preserves live recipes while cleaning orphans in a mixed cookbook", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const liveMp = await createTestMealPlanRecipe(testUser.id, {
        title: "Live MP",
      });
      const orphanMp = await createTestMealPlanRecipe(testUser.id, {
        title: "Orphan MP",
      });
      const liveC = await createTestCommunityRecipe(testUser.id, {
        title: "Live C",
      });
      await addRecipeToCookbook(
        cookbook.id,
        liveMp.id,
        "mealPlan",
        testUser.id,
      );
      await addRecipeToCookbook(
        cookbook.id,
        orphanMp.id,
        "mealPlan",
        testUser.id,
      );
      await addRecipeToCookbook(
        cookbook.id,
        liveC.id,
        "community",
        testUser.id,
      );

      // Orphan one of the meal-plan recipes.
      const { eq } = await import("drizzle-orm");
      await tx
        .delete(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, orphanMp.id));

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      const titles = result.map((r) => r.title);
      expect(titles).toEqual(expect.arrayContaining(["Live MP", "Live C"]));
      expect(titles).not.toContain("Orphan MP");

      expect(lastFireAndForgetPromise).not.toBeNull();
      await lastFireAndForgetPromise;

      // Only the live junction rows remain.
      const remaining = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(remaining).toHaveLength(2);
      const remainingIds = remaining.map((r) => r.recipeId);
      expect(remainingIds).toEqual(
        expect.arrayContaining([liveMp.id, liveC.id]),
      );
    });

    it("does not fire orphan cleanup when all junction rows resolve", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(lastFireAndForgetPromise).toBeNull();
    });

    it("does not resolve a mealPlan recipe owned by another user, and keeps the junction row (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      const foreignRecipe = await createTestMealPlanRecipe(otherUser.id, {
        title: "Foreign Secret",
      });
      // Insert a junction row directly, simulating a row leaked before the
      // add-path guard existed.
      await tx.insert(cookbookRecipes).values({
        cookbookId: cookbook.id,
        recipeId: foreignRecipe.id,
        recipeType: "mealPlan",
      });

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);

      // The recipe exists, so the junction row is NOT an orphan — it must be
      // kept (no fire-and-forget cleanup), just hidden from the response.
      expect(lastFireAndForgetPromise).toBeNull();
      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toHaveLength(1);
    });

    it("does not resolve another author's community recipe that was made private, and keeps the junction row", async () => {
      const otherUser = await createTestUser(tx);
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "C",
      });
      // Authored by someone else — once private, the caller must not see it.
      const recipe = await createTestCommunityRecipe(otherUser.id, {
        title: "Public Then Private",
      });
      await tx.insert(cookbookRecipes).values({
        cookbookId: cookbook.id,
        recipeId: recipe.id,
        recipeType: "community",
      });
      // Author later unpublishes the recipe.
      const { eq } = await import("drizzle-orm");
      await tx
        .update(communityRecipes)
        .set({ isPublic: false })
        .where(eq(communityRecipes.id, recipe.id));

      const result = await getResolvedCookbookRecipes(cookbook.id, testUser.id);
      expect(result).toEqual([]);

      // Recipe still exists — junction row preserved so it reappears if the
      // recipe is re-published.
      expect(lastFireAndForgetPromise).toBeNull();
      const rows = await getCookbookRecipes(cookbook.id, testUser.id);
      expect(rows).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Cascade: deleting a cookbook deletes its junction rows (DB-enforced FK)
  // --------------------------------------------------------------------------
  describe("cascade behavior", () => {
    it("deletes cookbook_recipes rows when the parent cookbook is deleted", async () => {
      const cookbook = await createCookbook({
        userId: testUser.id,
        name: "ToDelete",
      });
      const recipe = await createTestMealPlanRecipe(testUser.id);
      await addRecipeToCookbook(
        cookbook.id,
        recipe.id,
        "mealPlan",
        testUser.id,
      );

      await deleteCookbook(cookbook.id, testUser.id);

      // Confirm no orphan junction rows remain for this cookbook.
      const { eq } = await import("drizzle-orm");
      const remaining = await tx
        .select()
        .from(cookbookRecipes)
        .where(eq(cookbookRecipes.cookbookId, cookbook.id));
      expect(remaining).toEqual([]);

      // And the cookbook itself is gone.
      const gone = await tx
        .select()
        .from(cookbooksTable)
        .where(eq(cookbooksTable.id, cookbook.id));
      expect(gone).toEqual([]);
    });
  });
});
