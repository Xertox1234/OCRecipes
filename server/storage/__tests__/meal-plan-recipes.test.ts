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
import { eq, and } from "drizzle-orm";
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

type InsertMealPlanRecipe = schema.InsertMealPlanRecipe;
type InsertRecipeIngredient = schema.InsertRecipeIngredient;

// Mock the db import so the storage functions use our test transaction.
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock the search-index singleton so tests don't mutate process-wide index
// state. `getDocumentStore` returns a per-test Map that tests can pre-seed to
// exercise the "refresh existing entry" branch in `batchUpdateMealTypes`.
let mockDocumentStore = new Map<string, unknown>();
vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  mealPlanToSearchable: vi.fn((r: { id: number }) => ({
    id: `personal:${r.id}`,
  })),
  getDocumentStore: vi.fn(() => mockDocumentStore),
}));

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
const searchIndex = await import("../../lib/search-index");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let recipeSeq = 0;

/**
 * Build a minimal `InsertMealPlanRecipe`. `instructions` defaults to a single
 * step so the recipe passes `getUnifiedRecipes`' quality gate (which excludes
 * recipes with no instructions AND no ingredients).
 */
function makeRecipeInput(
  userId: string,
  overrides: Partial<InsertMealPlanRecipe> = {},
): InsertMealPlanRecipe {
  recipeSeq++;
  return {
    userId,
    title: `Test Recipe ${recipeSeq}`,
    instructions: ["Step 1"],
    ...overrides,
  };
}

/** Insert a meal-plan recipe directly and return the row. */
async function seedRecipe(
  userId: string,
  overrides: Partial<InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  const [recipe] = await tx
    .insert(mealPlanRecipes)
    .values(makeRecipeInput(userId, overrides))
    .returning();
  return recipe;
}

/** Insert a community recipe directly and return the row. */
async function seedCommunityRecipe(
  authorId: string,
  overrides: Record<string, unknown> = {},
): Promise<schema.CommunityRecipe> {
  recipeSeq++;
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId,
      title: `Community Recipe ${recipeSeq}`,
      // `test-` prefix lets global-teardown catch any leaked row.
      normalizedProductName: `test-product-${recipeSeq}`,
      instructions: ["Step 1"],
      isPublic: true,
      ...overrides,
    })
    .returning();
  return recipe;
}

function makeIngredient(
  overrides: Partial<InsertRecipeIngredient> = {},
): Omit<InsertRecipeIngredient, "recipeId"> {
  return {
    name: "Flour",
    quantity: "2",
    unit: "cup",
    ...overrides,
  };
}

describe("meal-plan-recipes storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    mockDocumentStore = new Map();
    vi.mocked(searchIndex.addToIndex).mockClear();
    vi.mocked(searchIndex.removeFromIndex).mockClear();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ==========================================================================
  // findMealPlanRecipeByExternalId
  // ==========================================================================
  describe("findMealPlanRecipeByExternalId", () => {
    it("returns the recipe matching userId + externalId", async () => {
      const recipe = await seedRecipe(testUser.id, { externalId: "ext-123" });
      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-123",
      );
      expect(result).toBeDefined();
      expect(result!.id).toBe(recipe.id);
    });

    it("returns undefined when externalId does not match", async () => {
      await seedRecipe(testUser.id, { externalId: "ext-123" });
      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-999",
      );
      expect(result).toBeUndefined();
    });

    it("does not return a recipe owned by a different user (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      await seedRecipe(otherUser.id, { externalId: "ext-shared" });
      const result = await findMealPlanRecipeByExternalId(
        testUser.id,
        "ext-shared",
      );
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // getMealPlanRecipe
  // ==========================================================================
  describe("getMealPlanRecipe", () => {
    it("returns the recipe when userId matches", async () => {
      const recipe = await seedRecipe(testUser.id);
      const result = await getMealPlanRecipe(recipe.id, testUser.id);
      expect(result!.id).toBe(recipe.id);
    });

    it("returns undefined when userId does not match (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await seedRecipe(otherUser.id);
      const result = await getMealPlanRecipe(recipe.id, testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns undefined for a nonexistent id", async () => {
      const result = await getMealPlanRecipe(999999, testUser.id);
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // getMealPlanRecipeWithIngredients
  // ==========================================================================
  describe("getMealPlanRecipeWithIngredients", () => {
    it("returns the recipe with its ingredients ordered by displayOrder", async () => {
      const recipe = await seedRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        { recipeId: recipe.id, name: "Salt", displayOrder: 1 },
        { recipeId: recipe.id, name: "Sugar", displayOrder: 0 },
      ]);
      const result = await getMealPlanRecipeWithIngredients(
        recipe.id,
        testUser.id,
      );
      expect(result).toBeDefined();
      expect(result!.ingredients.map((i) => i.name)).toEqual(["Sugar", "Salt"]);
    });

    it("returns an empty ingredients array when the recipe has none", async () => {
      const recipe = await seedRecipe(testUser.id);
      const result = await getMealPlanRecipeWithIngredients(
        recipe.id,
        testUser.id,
      );
      expect(result!.ingredients).toEqual([]);
    });

    it("returns undefined for a nonexistent recipe", async () => {
      const result = await getMealPlanRecipeWithIngredients(
        999999,
        testUser.id,
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined when userId does not match (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await seedRecipe(otherUser.id);
      const result = await getMealPlanRecipeWithIngredients(
        recipe.id,
        testUser.id,
      );
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // getUserMealPlanRecipes
  // ==========================================================================
  describe("getUserMealPlanRecipes", () => {
    it("returns an empty page when the user has no recipes", async () => {
      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("returns the user's recipes with the correct total", async () => {
      await seedRecipe(testUser.id);
      await seedRecipe(testUser.id);
      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("respects limit and offset while reporting the unpaginated total", async () => {
      for (let i = 0; i < 3; i++) await seedRecipe(testUser.id);
      const page = await getUserMealPlanRecipes(testUser.id, 2, 1);
      expect(page.items).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it("does not include recipes owned by another user (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      await seedRecipe(otherUser.id);
      const result = await getUserMealPlanRecipes(testUser.id);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ==========================================================================
  // createMealPlanRecipe
  // ==========================================================================
  describe("createMealPlanRecipe", () => {
    it("creates a recipe without ingredients and updates the index", async () => {
      const created = await createMealPlanRecipe(makeRecipeInput(testUser.id));
      expect(created.id).toBeGreaterThan(0);
      expect(searchIndex.addToIndex).toHaveBeenCalledTimes(1);

      const ings = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id));
      expect(ings).toEqual([]);
    });

    it("creates a recipe with ingredients in a single transaction", async () => {
      // recipeId is a placeholder — createMealPlanRecipe overwrites it with the
      // new recipe's id inside its transaction.
      const created = await createMealPlanRecipe(makeRecipeInput(testUser.id), [
        { recipeId: 0, name: "Eggs", displayOrder: 0 },
        { recipeId: 0, name: "Milk", displayOrder: 1 },
      ]);

      const ings = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id))
        .orderBy(recipeIngredients.displayOrder);
      expect(ings.map((i) => i.name)).toEqual(["Eggs", "Milk"]);
      expect(searchIndex.addToIndex).toHaveBeenCalledTimes(1);
    });

    it("assigns sequential displayOrder when ingredients omit it", async () => {
      const created = await createMealPlanRecipe(makeRecipeInput(testUser.id), [
        { recipeId: 0, name: "A" },
        { recipeId: 0, name: "B" },
      ]);
      const ings = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id))
        .orderBy(recipeIngredients.displayOrder);
      expect(ings.map((i) => i.displayOrder)).toEqual([0, 1]);
    });

    it("normalizes the recipe title and ingredient name/unit before persisting", async () => {
      const created = await createMealPlanRecipe(
        makeRecipeInput(testUser.id, { title: "chicken parmesan" }),
        [
          {
            recipeId: 0,
            name: "chicken breast",
            quantity: "2",
            unit: "pounds",
            displayOrder: 0,
          },
        ],
      );
      expect(created.title).toBe("Chicken Parmesan");

      const [ing] = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id));
      expect(ing.name).toBe("Chicken Breast");
      expect(ing.unit).toBe("lb");
    });

    it("converts a fraction ingredient quantity to a decimal string before persisting", async () => {
      const created = await createMealPlanRecipe(makeRecipeInput(testUser.id), [
        {
          recipeId: 0,
          name: "Salt",
          quantity: "1/2",
          unit: "tsp",
          displayOrder: 0,
        },
      ]);
      const [ing] = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id));
      expect(ing.quantity).toBe("0.50");
    });

    it("stores a null quantity when the ingredient quantity is unparseable freeform text", async () => {
      const created = await createMealPlanRecipe(makeRecipeInput(testUser.id), [
        {
          recipeId: 0,
          name: "Salt",
          quantity: "a pinch",
          unit: "",
          displayOrder: 0,
        },
      ]);
      const [ing] = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, created.id));
      expect(ing.quantity).toBeNull();
    });
  });

  // ==========================================================================
  // createMealPlanFromSuggestions
  // ==========================================================================
  describe("createMealPlanFromSuggestions", () => {
    it("returns an empty array for an empty input", async () => {
      const result = await createMealPlanFromSuggestions([]);
      expect(result).toEqual([]);
    });

    it("atomically creates recipes, ingredients and plan items", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: makeRecipeInput(testUser.id),
          ingredients: [makeIngredient({ name: "Tomato" })],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-05-15",
            mealType: "dinner",
          },
        },
        {
          recipe: makeRecipeInput(testUser.id),
          ingredients: [],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-05-16",
            mealType: "lunch",
          },
        },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].recipeId).toBeGreaterThan(0);
      expect(result[0].mealPlanItemId).toBeGreaterThan(0);

      // Ingredient was attached to the first recipe only.
      const firstIngs = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[0].recipeId));
      expect(firstIngs.map((i) => i.name)).toEqual(["Tomato"]);
      const secondIngs = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[1].recipeId));
      expect(secondIngs).toEqual([]);

      // Both plan items were created.
      const items = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.userId, testUser.id));
      expect(items).toHaveLength(2);

      // One index update per created recipe.
      expect(searchIndex.addToIndex).toHaveBeenCalledTimes(2);
    });

    it("normalizes ingredient name/unit and converts a fraction quantity to a decimal string", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: makeRecipeInput(testUser.id),
          ingredients: [
            makeIngredient({
              name: "chicken breast",
              quantity: "1/2",
              unit: "pounds",
            }),
          ],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-05-15",
            mealType: "dinner",
          },
        },
      ]);

      const [ing] = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[0].recipeId));
      expect(ing.name).toBe("Chicken Breast");
      expect(ing.unit).toBe("lb");
      expect(ing.quantity).toBe("0.50");
    });

    it("stores a null quantity instead of crashing when the ingredient quantity is unparseable freeform text", async () => {
      const result = await createMealPlanFromSuggestions([
        {
          recipe: makeRecipeInput(testUser.id),
          ingredients: [
            makeIngredient({ name: "Salt", quantity: "a pinch", unit: "" }),
          ],
          planItem: {
            userId: testUser.id,
            plannedDate: "2026-05-15",
            mealType: "dinner",
          },
        },
      ]);

      const [ing] = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, result[0].recipeId));
      expect(ing.quantity).toBeNull();
    });
  });

  // ==========================================================================
  // updateMealPlanRecipe
  // ==========================================================================
  describe("updateMealPlanRecipe", () => {
    it("updates editable fields and refreshes the index", async () => {
      const recipe = await seedRecipe(testUser.id, { title: "Old Title" });
      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "New Title",
        servings: 6,
      });
      expect(updated!.title).toBe("New Title");
      expect(updated!.servings).toBe(6);
      expect(searchIndex.addToIndex).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when the recipe belongs to another user (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await seedRecipe(otherUser.id);
      const result = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "Hijacked",
      });
      expect(result).toBeUndefined();
      expect(searchIndex.addToIndex).not.toHaveBeenCalled();
    });

    it("normalizes the title when updating", async () => {
      const recipe = await seedRecipe(testUser.id, { title: "Old Title" });
      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        title: "new title lowercase",
      });
      expect(updated!.title).toBe("New Title Lowercase");
    });

    it("normalizes difficulty when updating", async () => {
      const recipe = await seedRecipe(testUser.id);
      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        difficulty: "simple",
      });
      expect(updated!.difficulty).toBe("Easy");
    });

    it("does not throw on a title-omitting partial update (difficulty-only edit)", async () => {
      const recipe = await seedRecipe(testUser.id, {
        title: "Untouched Title",
      });
      const updated = await updateMealPlanRecipe(recipe.id, testUser.id, {
        difficulty: "hard",
      });
      expect(updated!.difficulty).toBe("Hard");
      expect(updated!.title).toBe("Untouched Title");
    });
  });

  // ==========================================================================
  // deleteMealPlanRecipe
  // ==========================================================================
  describe("deleteMealPlanRecipe", () => {
    it("deletes the recipe and removes it from the index", async () => {
      const recipe = await seedRecipe(testUser.id);
      const deleted = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(deleted).toBe(true);
      expect(await getMealPlanRecipe(recipe.id, testUser.id)).toBeUndefined();
      expect(searchIndex.removeFromIndex).toHaveBeenCalledWith(
        `personal:${recipe.id}`,
      );
    });

    it("cleans up cookbook and favourite junction rows", async () => {
      const recipe = await seedRecipe(testUser.id);
      const [cookbook] = await tx
        .insert(cookbooks)
        .values({ userId: testUser.id, name: "My Cookbook" })
        .returning();
      await tx.insert(cookbookRecipes).values({
        cookbookId: cookbook.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });
      await tx.insert(favouriteRecipes).values({
        userId: testUser.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });

      await deleteMealPlanRecipe(recipe.id, testUser.id);

      const cbLeft = await tx
        .select()
        .from(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, recipe.id),
            eq(cookbookRecipes.recipeType, "mealPlan"),
          ),
        );
      expect(cbLeft).toEqual([]);
      const favLeft = await tx
        .select()
        .from(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.recipeId, recipe.id),
            eq(favouriteRecipes.recipeType, "mealPlan"),
          ),
        );
      expect(favLeft).toEqual([]);
    });

    it("returns false and skips index removal for a nonexistent recipe", async () => {
      const deleted = await deleteMealPlanRecipe(999999, testUser.id);
      expect(deleted).toBe(false);
      expect(searchIndex.removeFromIndex).not.toHaveBeenCalled();
    });

    it("returns false when the recipe belongs to another user (IDOR scoping)", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await seedRecipe(otherUser.id);
      const deleted = await deleteMealPlanRecipe(recipe.id, testUser.id);
      expect(deleted).toBe(false);
      expect(await getMealPlanRecipe(recipe.id, otherUser.id)).toBeDefined();
    });
  });

  // ==========================================================================
  // getAllMealPlanRecipes
  // ==========================================================================
  describe("getAllMealPlanRecipes", () => {
    it("returns recipes across all users (no user filter)", async () => {
      const otherUser = await createTestUser(tx);
      const mine = await seedRecipe(testUser.id);
      const theirs = await seedRecipe(otherUser.id);
      const result = await getAllMealPlanRecipes();
      const ids = result.map((r) => r.id);
      expect(ids).toContain(mine.id);
      expect(ids).toContain(theirs.id);
    });
  });

  // ==========================================================================
  // getAllRecipeIngredients
  // ==========================================================================
  // No user filter — these tests are additive (the dev DB may hold seed
  // rows), asserting on specific seeded recipeIds rather than total size.
  describe("getAllRecipeIngredients", () => {
    it("does not key recipes that have no ingredients", async () => {
      const recipe = await seedRecipe(testUser.id);
      const result = await getAllRecipeIngredients();
      expect(result.has(recipe.id)).toBe(false);
    });

    it("groups ingredients by recipeId", async () => {
      const r1 = await seedRecipe(testUser.id);
      const r2 = await seedRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        { recipeId: r1.id, name: "Salt", displayOrder: 0 },
        { recipeId: r1.id, name: "Pepper", displayOrder: 1 },
        { recipeId: r2.id, name: "Oil", displayOrder: 0 },
      ]);
      const result = await getAllRecipeIngredients();
      expect(result.get(r1.id)!.map((i) => i.name)).toEqual(["Salt", "Pepper"]);
      expect(result.get(r2.id)!.map((i) => i.name)).toEqual(["Oil"]);
    });
  });

  // ==========================================================================
  // getUnifiedRecipes
  // ==========================================================================
  describe("getUnifiedRecipes", () => {
    it("returns the user's personal recipes and public community recipes", async () => {
      const otherUser = await createTestUser(tx);
      const personal = await seedRecipe(testUser.id, { title: "My Pasta" });
      const community = await seedCommunityRecipe(otherUser.id, {
        title: "Shared Soup",
      });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal.map((r) => r.id)).toContain(personal.id);
      expect(result.community.map((r) => r.id)).toContain(community.id);
    });

    it("excludes personal recipes with no instructions and no ingredients (quality gate)", async () => {
      const empty = await seedRecipe(testUser.id, { instructions: [] });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal.map((r) => r.id)).not.toContain(empty.id);
    });

    it("includes an instruction-less personal recipe once it has an ingredient", async () => {
      const recipe = await seedRecipe(testUser.id, { instructions: [] });
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: recipe.id, name: "Rice", displayOrder: 0 });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.personal.map((r) => r.id)).toContain(recipe.id);
    });

    it("filters personal recipes by a title query", async () => {
      const match = await seedRecipe(testUser.id, { title: "Banana Bread" });
      await seedRecipe(testUser.id, { title: "Beef Stew" });
      const result = await getUnifiedRecipes({
        userId: testUser.id,
        query: "banana",
      });
      const ids = result.personal.map((r) => r.id);
      expect(ids).toContain(match.id);
      expect(ids).toHaveLength(1);
    });

    it("filters personal recipes by cuisine", async () => {
      const match = await seedRecipe(testUser.id, { cuisine: "Italian" });
      await seedRecipe(testUser.id, { cuisine: "Mexican" });
      const result = await getUnifiedRecipes({
        userId: testUser.id,
        cuisine: "italian",
      });
      const ids = result.personal.map((r) => r.id);
      expect(ids).toContain(match.id);
      expect(ids).toHaveLength(1);
    });

    it("filters personal recipes by diet tag", async () => {
      const match = await seedRecipe(testUser.id, { dietTags: ["vegan"] });
      await seedRecipe(testUser.id, { dietTags: ["keto"] });
      const result = await getUnifiedRecipes({
        userId: testUser.id,
        diet: "vegan",
      });
      const ids = result.personal.map((r) => r.id);
      expect(ids).toContain(match.id);
      expect(ids).toHaveLength(1);
    });

    it("filters by mealType but keeps recipes with empty mealTypes visible", async () => {
      const tagged = await seedRecipe(testUser.id, {
        mealTypes: ["breakfast"],
      });
      const untagged = await seedRecipe(testUser.id, { mealTypes: [] });
      const wrongTag = await seedRecipe(testUser.id, { mealTypes: ["dinner"] });
      const result = await getUnifiedRecipes({
        userId: testUser.id,
        mealType: "breakfast",
      });
      const ids = result.personal.map((r) => r.id);
      expect(ids).toContain(tagged.id);
      expect(ids).toContain(untagged.id);
      expect(ids).not.toContain(wrongTag.id);
    });

    it("excludes non-public community recipes", async () => {
      const otherUser = await createTestUser(tx);
      const priv = await seedCommunityRecipe(otherUser.id, {
        isPublic: false,
      });
      const result = await getUnifiedRecipes({ userId: testUser.id });
      expect(result.community.map((r) => r.id)).not.toContain(priv.id);
    });
  });

  // ==========================================================================
  // getRecipesWithEmptyMealTypes
  // ==========================================================================
  // No user filter — these tests are additive (the dev DB may hold seed
  // rows), asserting on specific seeded recipeIds rather than total size.
  describe("getRecipesWithEmptyMealTypes", () => {
    it("does not return a recipe whose mealTypes are classified", async () => {
      const classified = await seedRecipe(testUser.id, {
        mealTypes: ["lunch"],
      });
      const result = await getRecipesWithEmptyMealTypes();
      expect(result.recipes.map((r) => r.id)).not.toContain(classified.id);
    });

    it("returns recipes with empty mealTypes along with their ingredients", async () => {
      const empty = await seedRecipe(testUser.id, { mealTypes: [] });
      await seedRecipe(testUser.id, { mealTypes: ["dinner"] });
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: empty.id, name: "Onion", displayOrder: 0 });

      const result = await getRecipesWithEmptyMealTypes();
      const ids = result.recipes.map((r) => r.id);
      expect(ids).toContain(empty.id);
      expect(result.ingredientsByRecipe.get(empty.id)).toEqual(["Onion"]);
    });
  });

  // ==========================================================================
  // batchUpdateMealTypes
  // ==========================================================================
  describe("batchUpdateMealTypes", () => {
    it("returns 0 for an empty update list", async () => {
      const count = await batchUpdateMealTypes([]);
      expect(count).toBe(0);
    });

    it("updates mealTypes for multiple recipes in one round-trip", async () => {
      const r1 = await seedRecipe(testUser.id, { mealTypes: [] });
      const r2 = await seedRecipe(testUser.id, { mealTypes: [] });
      const count = await batchUpdateMealTypes([
        { id: r1.id, mealTypes: ["breakfast"] },
        { id: r2.id, mealTypes: ["lunch", "dinner"] },
      ]);
      expect(count).toBe(2);

      const [row1] = await tx
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, r1.id));
      const [row2] = await tx
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, r2.id));
      expect(row1.mealTypes).toEqual(["breakfast"]);
      expect(row2.mealTypes).toEqual(["lunch", "dinner"]);
    });

    it("refreshes the search index for entries already in the document store", async () => {
      const recipe = await seedRecipe(testUser.id, { mealTypes: [] });
      mockDocumentStore.set(`personal:${recipe.id}`, {
        id: `personal:${recipe.id}`,
        mealTypes: [],
      });
      await batchUpdateMealTypes([{ id: recipe.id, mealTypes: ["snack"] }]);
      expect(searchIndex.addToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ mealTypes: ["snack"] }),
      );
    });
  });
});
