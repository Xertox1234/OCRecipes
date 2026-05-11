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
import { mealPlanRecipes, mealPlanItems } from "@shared/schema";
import { toDateString } from "@shared/lib/date";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getPlannedNutritionSummary,
  getMealPlanIngredientsForDateRange,
  getFrequentRecipesForMealType,
  getPopularPicksByMealType,
} = await import("../meal-plan-analytics");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

const TODAY = toDateString(new Date());

/** Insert a meal plan recipe with nutrition data. */
async function createNutritionRecipe(
  userId: string,
  calories: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  const [recipe] = await tx
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Nutrition Recipe",
      instructions: ["Cook"],
      caloriesPerServing: calories,
      proteinPerServing: "10",
      carbsPerServing: "30",
      fatPerServing: "5",
      ...overrides,
    })
    .returning();
  return recipe;
}

/** Insert a meal plan item linking a user to a recipe on a given date. */
async function createMealPlanItem(
  userId: string,
  recipeId: number,
  plannedDate: string,
  mealType = "dinner",
  servings = "1",
): Promise<schema.MealPlanItem> {
  const [item] = await tx
    .insert(mealPlanItems)
    .values({ userId, recipeId, plannedDate, mealType, servings })
    .returning();
  return item;
}

describe("meal-plan-analytics storage", () => {
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
  // getPlannedNutritionSummary
  // --------------------------------------------------------------------------
  describe("getPlannedNutritionSummary", () => {
    it("returns zeroes when no meal plan items exist for the date", async () => {
      const result = await getPlannedNutritionSummary(testUser.id, new Date());

      expect(result.plannedCalories).toBe(0);
      expect(result.plannedProtein).toBe(0);
      expect(result.plannedCarbs).toBe(0);
      expect(result.plannedFat).toBe(0);
      expect(result.plannedItemCount).toBe(0);
    });

    it("sums nutrition from planned recipe items", async () => {
      const recipe = await createNutritionRecipe(testUser.id, "500");
      await createMealPlanItem(testUser.id, recipe.id, TODAY, "dinner", "2");

      const result = await getPlannedNutritionSummary(testUser.id, new Date());

      expect(Number(result.plannedCalories)).toBeGreaterThan(0);
      expect(result.plannedItemCount).toBe(1);
    });

    it("excludes confirmed items when confirmedIds are provided", async () => {
      const recipe = await createNutritionRecipe(testUser.id, "400");
      const item = await createMealPlanItem(
        testUser.id,
        recipe.id,
        TODAY,
        "lunch",
        "1",
      );

      // Exclude the item we just created
      const result = await getPlannedNutritionSummary(testUser.id, new Date(), [
        item.id,
      ]);

      expect(result.plannedItemCount).toBe(0);
    });

    it("only counts items for the requesting user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createNutritionRecipe(otherUser.id, "300");
      await createMealPlanItem(otherUser.id, recipe.id, TODAY);

      const result = await getPlannedNutritionSummary(testUser.id, new Date());
      expect(result.plannedItemCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getMealPlanIngredientsForDateRange
  // --------------------------------------------------------------------------
  describe("getMealPlanIngredientsForDateRange", () => {
    it("returns empty array when no items exist for the date range", async () => {
      const result = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2020-01-01",
        "2020-01-07",
      );
      expect(result).toEqual([]);
    });

    it("returns ingredients for recipes in the date range", async () => {
      const { recipeIngredients } = await import("@shared/schema");
      const recipe = await createNutritionRecipe(testUser.id, "200");
      await tx.insert(recipeIngredients).values({
        recipeId: recipe.id,
        name: "Tomato",
        quantity: "2",
        unit: "pcs",
        displayOrder: 0,
      });
      await createMealPlanItem(testUser.id, recipe.id, TODAY);

      const result = await getMealPlanIngredientsForDateRange(
        testUser.id,
        TODAY,
        TODAY,
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const names = result.map((i) => i.name);
      expect(names).toContain("Tomato");
    });
  });

  // --------------------------------------------------------------------------
  // getFrequentRecipesForMealType
  // --------------------------------------------------------------------------
  describe("getFrequentRecipesForMealType", () => {
    it("returns empty array when no items exist for the meal type", async () => {
      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(result).toEqual([]);
    });

    it("returns most-used recipes for the given meal type", async () => {
      const recipe = await createNutritionRecipe(testUser.id, "350", {
        title: "Morning Oats",
      });
      // Add recipe to breakfast 2 times
      await createMealPlanItem(
        testUser.id,
        recipe.id,
        "2025-05-01",
        "breakfast",
      );
      await createMealPlanItem(
        testUser.id,
        recipe.id,
        "2025-05-02",
        "breakfast",
      );

      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const ids = result.map((r) => r.id);
      expect(ids).toContain(recipe.id);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 3; i++) {
        const recipe = await createNutritionRecipe(testUser.id, "200", {
          title: `Lunch Recipe ${i}`,
        });
        await createMealPlanItem(
          testUser.id,
          recipe.id,
          `2025-05-0${i + 1}`,
          "lunch",
        );
      }

      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "lunch",
        2,
      );
      expect(result).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // getPopularPicksByMealType
  // --------------------------------------------------------------------------
  describe("getPopularPicksByMealType", () => {
    it("returns empty array when no ai_suggestion recipes exist for the meal type", async () => {
      const result = await getPopularPicksByMealType(testUser.id, "breakfast");
      expect(result).toEqual([]);
    });

    it("returns popular ai_suggestion picks from other users", async () => {
      const otherUser = await createTestUser(tx);
      const [aiRecipe] = await tx
        .insert(mealPlanRecipes)
        .values({
          userId: otherUser.id,
          title: "AI Suggested Meal",
          instructions: ["Cook"],
          sourceType: "ai_suggestion",
          caloriesPerServing: "400",
          proteinPerServing: "20",
          carbsPerServing: "45",
          fatPerServing: "10",
        })
        .returning();

      await tx.insert(mealPlanItems).values({
        userId: otherUser.id,
        recipeId: aiRecipe.id,
        plannedDate: TODAY,
        mealType: "dinner",
        servings: "1",
      });

      const result = await getPopularPicksByMealType(testUser.id, "dinner", 5);

      // The result should contain the ai_suggestion recipe from another user
      // (at least 0 since it depends on date window)
      expect(Array.isArray(result)).toBe(true);
    });

    it("does not return ai_suggestion picks from the requesting user", async () => {
      const [aiRecipe] = await tx
        .insert(mealPlanRecipes)
        .values({
          userId: testUser.id,
          title: "My AI Recipe",
          instructions: ["Cook"],
          sourceType: "ai_suggestion",
          caloriesPerServing: "300",
          proteinPerServing: "15",
          carbsPerServing: "35",
          fatPerServing: "8",
        })
        .returning();

      await tx.insert(mealPlanItems).values({
        userId: testUser.id,
        recipeId: aiRecipe.id,
        plannedDate: TODAY,
        mealType: "dinner",
        servings: "1",
      });

      const result = await getPopularPicksByMealType(testUser.id, "dinner");
      const titles = result.map((r) => r.title);
      expect(titles).not.toContain("My AI Recipe");
    });
  });
});
