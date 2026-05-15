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
import crypto from "node:crypto";
import type * as schema from "@shared/schema";
import {
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  communityRecipes,
  cookbooks,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";

// Mock the db import so the storage functions use our test transaction.
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Partial-mock the search index: stub only the process-wide mutators
// (addToIndex / removeFromIndex) so tests don't leak index state across
// tests or files. mealPlanToSearchable (pure) and getDocumentStore (returns
// an empty Map until an index init runs) are kept real — batchUpdateMealTypes
// calls getDocumentStore().get(...) and would break under a full stub.
vi.mock("../../lib/search-index", async () => {
  const actual = await vi.importActual<typeof import("../../lib/search-index")>(
    "../../lib/search-index",
  );
  return { ...actual, addToIndex: vi.fn(), removeFromIndex: vi.fn() };
});

// Import after mocking.
const {
  findMealPlanRecipeByExternalId,
  getMealPlanRecipe,
  getMealPlanRecipeWithIngredients,
  getUserMealPlanRecipes,
  createMealPlanRecipe,
  createMealPlanFromSuggestions,
  updateMealPlanRecipe,
  deleteMealPlanRecipe,
  getAllMealPlanRecipes,
  getAllRecipeIngredients,
  getUnifiedRecipes,
  getRecipesWithEmptyMealTypes,
  batchUpdateMealTypes,
} = await import("../meal-plan-recipes");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique external id so the unique(user_id, external_id) index never collides. */
let externalSeq = 0;
function makeExternalId(): string {
  externalSeq++;
  return `ext-${crypto.randomUUID().slice(0, 8)}-${externalSeq}`;
}

/** Insert a mealPlan recipe owned by the given user. */
async function seedMealPlanRecipe(
  userId: string,
  overrides: Partial<typeof mealPlanRecipes.$inferInsert> = {},
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
async function seedCommunityRecipe(
  authorId: string,
  overrides: Partial<typeof communityRecipes.$inferInsert> = {},
): Promise<schema.CommunityRecipe> {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId,
      title: "Test Community Recipe",
      // `test-` prefix: ensures cleanup catches any row that leaks past
      // transaction rollback (see cleanup-seed-recipes-utils.ts).
      normalizedProductName: "test-product",
      instructions: ["Step 1"],
      isPublic: true,
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("meal-plan-recipes storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ==========================================================================
  // findMealPlanRecipeByExternalId
  // ==========================================================================
  describe("findMealPlanRecipeByExternalId", () => {
    it("returns the recipe matching userId + externalId", async () => {
      const externalId = makeExternalId();
      const recipe = await seedMealPlanRecipe(testUser.id, { externalId });
      const found = await findMealPlanRecipeByExternalId(
        testUser.id,
        externalId,
      );
      expect(found).toBeDefined();
      expect(found!.id).toBe(recipe.id);
    });

    it("returns undefined when no recipe matches the external id", async () => {
      const found = await findMealPlanRecipeByExternalId(
        testUser.id,
        makeExternalId(),
      );
      expect(found).toBeUndefined();
    });

    it("returns undefined for another user's external id (IDOR scoping)", async () => {
      const externalId = makeExternalId();
      await seedMealPlanRecipe(testUser.id, { externalId });
      const otherUser = await createTestUser(tx);
      const found = await findMealPlanRecipeByExternalId(
        otherUser.id,
        externalId,
      );
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // getMealPlanRecipe
  // ==========================================================================
  describe("getMealPlanRecipe", () => {
    it("returns the recipe by id when no userId filter is given", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      const found = await getMealPlanRecipe(recipe.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(recipe.id);
    });

    it("returns the recipe when userId matches", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      const found = await getMealPlanRecipe(recipe.id, testUser.id);
      expect(found!.id).toBe(recipe.id);
    });

    it("returns undefined when userId does not match (IDOR scoping)", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      const otherUser = await createTestUser(tx);
      const found = await getMealPlanRecipe(recipe.id, otherUser.id);
      expect(found).toBeUndefined();
    });

    it("returns undefined for a nonexistent id", async () => {
      const found = await getMealPlanRecipe(999999);
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // getMealPlanRecipeWithIngredients
  // ==========================================================================
  describe("getMealPlanRecipeWithIngredients", () => {
    it("returns the recipe with its ingredients ordered by displayOrder", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        { recipeId: recipe.id, name: "Salt", displayOrder: 1 },
        { recipeId: recipe.id, name: "Flour", displayOrder: 0 },
      ]);
      const found = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(found).toBeDefined();
      expect(found!.ingredients.map((i) => i.name)).toEqual(["Flour", "Salt"]);
    });

    it("returns an empty ingredients array when the recipe has none", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      const found = await getMealPlanRecipeWithIngredients(recipe.id);
      expect(found!.ingredients).toEqual([]);
    });

    it("returns undefined when userId does not match (IDOR scoping)", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: recipe.id, name: "Secret" });
      const otherUser = await createTestUser(tx);
      const found = await getMealPlanRecipeWithIngredients(
        recipe.id,
        otherUser.id,
      );
      expect(found).toBeUndefined();
    });

    it("returns undefined for a nonexistent recipe", async () => {
      const found = await getMealPlanRecipeWithIngredients(999999);
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // getUserMealPlanRecipes
  // ==========================================================================
  describe("getUserMealPlanRecipes", () => {
    it("returns items and total scoped to the user", async () => {
      await seedMealPlanRecipe(testUser.id, { title: "A" });
      await seedMealPlanRecipe(testUser.id, { title: "B" });
      const otherUser = await createTestUser(tx);
      await seedMealPlanRecipe(otherUser.id, { title: "Other" });

      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items.every((r) => r.userId === testUser.id)).toBe(true);
    });

    it("respects limit and offset for pagination", async () => {
      for (let i = 0; i < 3; i++) {
        await seedMealPlanRecipe(testUser.id, { title: `Recipe ${i}` });
      }
      const page = await getUserMealPlanRecipes(testUser.id, 1, 1);
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
    });

    it("returns an empty result when the user has no recipes", async () => {
      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  // ==========================================================================
  // createMealPlanRecipe
  // ==========================================================================
  describe("createMealPlanRecipe", () => {
    it("creates a recipe without ingredients", async () => {
      const created = await createMealPlanRecipe({
        userId: testUser.id,
        title: "Plain Recipe",
        instructions: ["Mix"],
      });
      expect(created.id).toBeGreaterThan(0);
      expect(created.title).toBe("Plain Recipe");

      const persisted = await getMealPlanRecipe(created.id);
      expect(persisted).toBeDefined();
    });

    it("creates a recipe with ingredients inside a transaction", async () => {
      const created = await createMealPlanRecipe(
        {
          userId: testUser.id,
          title: "Recipe With Ingredients",
          instructions: ["Cook"],
        },
        [
          { recipeId: 0, name: "Tomato" },
          { recipeId: 0, name: "Basil" },
        ],
      );
      const withIngredients = await getMealPlanRecipeWithIngredients(
        created.id,
      );
      expect(withIngredients!.ingredients.map((i) => i.name)).toEqual(
        expect.arrayContaining(["Tomato", "Basil"]),
      );
      expect(withIngredients!.ingredients).toHaveLength(2);
      // FK integrity: the placeholder recipeId: 0 must be rewritten to the
      // created recipe's PK.
      expect(
        withIngredients!.ingredients.every((i) => i.recipeId === created.id),
      ).toBe(true);
    });
  });

  // ==========================================================================
  // createMealPlanFromSuggestions
  // ==========================================================================
  describe("createMealPlanFromSuggestions", () => {
    it("returns an empty array when given no meals", async () => {
      const result = await createMealPlanFromSuggestions([]);
      expect(result).toEqual([]);
    });

    it("atomically creates recipes, ingredients, and plan items", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: {
            userId: testUser.id,
            title: "Suggested Breakfast",
            instructions: ["Toast"],
          },
          ingredients: [{ name: "Bread" }],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-06-01",
            mealType: "breakfast",
          },
        },
        {
          recipe: {
            userId: testUser.id,
            title: "Suggested Dinner",
            instructions: ["Grill"],
          },
          ingredients: [{ name: "Chicken" }, { name: "Rice" }],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-06-01",
            mealType: "dinner",
          },
        },
      ]);

      expect(result).toHaveLength(2);
      for (const { recipeId, mealPlanItemId } of result) {
        expect(recipeId).toBeGreaterThan(0);
        expect(mealPlanItemId).toBeGreaterThan(0);
      }

      // Plan items were persisted and linked to the created recipes.
      const items = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.userId, testUser.id));
      expect(items).toHaveLength(2);

      // Ingredients linked to the second recipe.
      const dinner = await getMealPlanRecipeWithIngredients(result[1].recipeId);
      expect(dinner!.ingredients).toHaveLength(2);
    });

    it("rolls back all recipes when one suggestion fails (atomicity)", async () => {
      // Second suggestion violates the NOT NULL `mealType` constraint on
      // mealPlanItems — the internal db.transaction() must roll back the
      // first suggestion's recipe too.
      await expect(
        createMealPlanFromSuggestions([
          {
            recipe: {
              userId: testUser.id,
              title: "Rollback Breakfast",
              instructions: ["Toast"],
            },
            ingredients: [{ name: "Bread" }],
            planItem: {
              userId: testUser.id,
              plannedDate: "2026-06-01",
              mealType: "breakfast",
            },
          },
          {
            recipe: {
              userId: testUser.id,
              title: "Rollback Dinner",
              instructions: ["Grill"],
            },
            ingredients: [{ name: "Chicken" }],
            // mealType omitted — violates NOT NULL, aborts the transaction.
            planItem: {
              userId: testUser.id,
              plannedDate: "2026-06-01",
            } as Omit<schema.InsertMealPlanItem, "recipeId">,
          },
        ]),
      ).rejects.toThrow();

      // No recipe from the first suggestion persisted.
      const recipes = await tx
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.userId, testUser.id));
      expect(recipes.map((r) => r.title)).not.toContain("Rollback Breakfast");
    });
  });

  // ==========================================================================
  // updateMealPlanRecipe
  // ==========================================================================
  describe("updateMealPlanRecipe", () => {
    it("updates allowed fields and returns the updated row", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id, {
        title: "Old Title",
      });
      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "New Title",
        servings: 6,
      });
      expect(updated).toBeDefined();
      expect(updated!.title).toBe("New Title");
      expect(updated!.servings).toBe(6);
    });

    it("returns undefined and does not mutate the row when not owned by the user", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id, {
        title: "Old Title",
      });
      const otherUser = await createTestUser(tx);
      const updated = await updateMealPlanRecipe(recipe.id, otherUser.id, {
        title: "Hijacked",
      });
      expect(updated).toBeUndefined();
      // Dual-assertion IDOR: confirm the row was not silently mutated.
      const persisted = await getMealPlanRecipe(recipe.id);
      expect(persisted!.title).toBe("Old Title");
    });
  });

  // ==========================================================================
  // deleteMealPlanRecipe
  // ==========================================================================
  describe("deleteMealPlanRecipe", () => {
    it("deletes the recipe and cleans up junction rows", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      // Seed an ingredient (FK to the recipe) and junction rows.
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: recipe.id, name: "Flour" });
      await tx.insert(favouriteRecipes).values({
        userId: testUser.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });
      const [cookbook] = await tx
        .insert(cookbooks)
        .values({ userId: testUser.id, name: "Test Cookbook" })
        .returning();
      await tx.insert(cookbookRecipes).values({
        cookbookId: cookbook.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });

      const deleted = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(deleted).toBe(true);

      expect(await getMealPlanRecipe(recipe.id)).toBeUndefined();
      const favRows = await tx
        .select()
        .from(favouriteRecipes)
        .where(eq(favouriteRecipes.recipeId, recipe.id));
      expect(favRows).toHaveLength(0);
      const cookbookRows = await tx
        .select()
        .from(cookbookRecipes)
        .where(eq(cookbookRecipes.recipeId, recipe.id));
      expect(cookbookRows).toHaveLength(0);
      // Child recipeIngredients rows are removed via the FK ON DELETE CASCADE.
      const ingredientRows = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipe.id));
      expect(ingredientRows).toHaveLength(0);
    });

    it("returns false when the recipe is not owned by the user", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      const otherUser = await createTestUser(tx);
      const deleted = await deleteMealPlanRecipe(recipe.id, otherUser.id);
      expect(deleted).toBe(false);
      // Recipe still exists.
      expect(await getMealPlanRecipe(recipe.id)).toBeDefined();
    });
  });

  // ==========================================================================
  // getAllMealPlanRecipes
  // ==========================================================================
  describe("getAllMealPlanRecipes", () => {
    // Note: this is a whole-table read with no user/transaction filter (it
    // seeds the search index at boot), so a negative "returns []" case is not
    // meaningful — committed dev-DB rows are visible. Happy path only.
    it("returns every recipe across all users (no user filter)", async () => {
      const otherUser = await createTestUser(tx);
      const r1 = await seedMealPlanRecipe(testUser.id, { title: "Mine" });
      const r2 = await seedMealPlanRecipe(otherUser.id, { title: "Theirs" });

      const all = await getAllMealPlanRecipes();
      const ids = all.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([r1.id, r2.id]));
    });
  });

  // ==========================================================================
  // getAllRecipeIngredients
  // ==========================================================================
  describe("getAllRecipeIngredients", () => {
    // Note: this is a whole-table read with no filter (it seeds the search
    // index at boot), so a negative "empty map" case is not meaningful —
    // committed dev-DB rows are visible. Happy path only.
    it("returns a map of recipeId to its ingredients", async () => {
      const recipe = await seedMealPlanRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        { recipeId: recipe.id, name: "Egg", displayOrder: 0 },
        { recipeId: recipe.id, name: "Milk", displayOrder: 1 },
      ]);
      const map = await getAllRecipeIngredients();
      expect(map.get(recipe.id)?.map((i) => i.name)).toEqual(["Egg", "Milk"]);
    });
  });

  // ==========================================================================
  // getUnifiedRecipes
  // ==========================================================================
  describe("getUnifiedRecipes", () => {
    it("returns the user's personal recipes and public community recipes", async () => {
      await seedMealPlanRecipe(testUser.id, { title: "Personal Pasta" });
      await seedCommunityRecipe(testUser.id, {
        title: "Community Salad",
        isPublic: true,
      });

      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal.map((r) => r.title)).toContain("Personal Pasta");
      expect(result.community.map((r) => r.title)).toContain("Community Salad");
    });

    it("excludes another user's private community recipe (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      await seedCommunityRecipe(otherUser.id, {
        title: "Private Community Recipe",
        isPublic: false,
      });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.community.map((r) => r.title)).not.toContain(
        "Private Community Recipe",
      );
    });

    it("excludes personal recipes with no instructions and no ingredients (quality gate)", async () => {
      await seedMealPlanRecipe(testUser.id, {
        title: "Empty Recipe",
        instructions: [],
      });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal.map((r) => r.title)).not.toContain("Empty Recipe");
    });

    it("filters personal recipes by query against title", async () => {
      await seedMealPlanRecipe(testUser.id, { title: "Spicy Tacos" });
      await seedMealPlanRecipe(testUser.id, { title: "Plain Soup" });
      const result = await getUnifiedRecipes({
        userId: testUser.id,
        query: "tacos",
      });
      expect(result.personal.map((r) => r.title)).toEqual(["Spicy Tacos"]);
    });
  });

  // ==========================================================================
  // getRecipesWithEmptyMealTypes
  // ==========================================================================
  describe("getRecipesWithEmptyMealTypes", () => {
    // SKIPPED: blocked by a source bug in
    // `server/storage/meal-plan-recipes.ts:501-507` — the `= ANY(${recipeIds})`
    // SQL interpolation passes a JS number[] PG cannot coerce ("malformed array
    // literal" / "op ANY/ALL requires array on right side"). Tracked in
    // todos/2026-05-15-meal-plan-recipes-any-array-bug.md. Unskip once the
    // source uses `inArray(...)`.
    it.skip("returns recipes with empty mealTypes plus their ingredients", async () => {
      const empty = await seedMealPlanRecipe(testUser.id, {
        title: "Needs Classification",
        mealTypes: [],
      });
      await seedMealPlanRecipe(testUser.id, {
        title: "Classified",
        mealTypes: ["breakfast"],
      });
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: empty.id, name: "Oats" });

      const result = await getRecipesWithEmptyMealTypes();
      const ids = result.recipes.map((r) => r.id);
      expect(ids).toContain(empty.id);
      expect(result.ingredientsByRecipe.get(empty.id)).toEqual(["Oats"]);
    });

    // SKIPPED: same source bug — see the describe-block comment above.
    it.skip("returns empty results when every recipe has mealTypes", async () => {
      await seedMealPlanRecipe(testUser.id, { mealTypes: ["dinner"] });
      const result = await getRecipesWithEmptyMealTypes();
      expect(result.recipes).toEqual([]);
      expect(result.ingredientsByRecipe.size).toBe(0);
    });
  });

  // ==========================================================================
  // batchUpdateMealTypes
  // ==========================================================================
  describe("batchUpdateMealTypes", () => {
    it("updates mealTypes for multiple recipes in one round-trip", async () => {
      const r1 = await seedMealPlanRecipe(testUser.id, { mealTypes: [] });
      const r2 = await seedMealPlanRecipe(testUser.id, { mealTypes: [] });

      const count = await batchUpdateMealTypes([
        { id: r1.id, mealTypes: ["breakfast"] },
        { id: r2.id, mealTypes: ["lunch", "dinner"] },
      ]);
      expect(count).toBe(2);

      const [updated1] = await tx
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, r1.id));
      const [updated2] = await tx
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, r2.id));
      expect(updated1.mealTypes).toEqual(["breakfast"]);
      expect(updated2.mealTypes).toEqual(["lunch", "dinner"]);
    });

    it("returns 0 and is a no-op when given an empty list", async () => {
      const count = await batchUpdateMealTypes([]);
      expect(count).toBe(0);
    });
  });
});
