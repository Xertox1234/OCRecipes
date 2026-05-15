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
  mealPlanRecipes,
  mealPlanItems,
  recipeIngredients,
  scannedItems,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getPlannedNutritionSummary,
  getMealPlanIngredientsForDateRange,
  getFrequentRecipesForMealType,
  getPopularPicksByMealType,
} = await import("../meal-plan-analytics");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

async function createRecipe(
  userId: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  const [r] = await tx
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Test Recipe",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return r;
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

  describe("getPlannedNutritionSummary", () => {
    it("returns zeros when no items are planned for the date", async () => {
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2026-05-15T12:00:00Z"),
      );
      expect(Number(summary.plannedCalories)).toBe(0);
      expect(Number(summary.plannedProtein)).toBe(0);
      expect(Number(summary.plannedCarbs)).toBe(0);
      expect(Number(summary.plannedFat)).toBe(0);
      expect(Number(summary.plannedItemCount)).toBe(0);
    });

    it("sums macros from recipe-backed meal plan items, scaled by servings", async () => {
      const recipe = await createRecipe(testUser.id, {
        caloriesPerServing: "400",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "10",
      });
      await tx.insert(mealPlanItems).values({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "lunch",
        servings: "2",
      });
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2026-05-15T12:00:00Z"),
      );
      expect(Number(summary.plannedCalories)).toBe(800);
      expect(Number(summary.plannedProtein)).toBe(60);
      expect(Number(summary.plannedItemCount)).toBe(1);
    });

    it("excludes items already confirmed via the confirmedIds parameter", async () => {
      const recipe = await createRecipe(testUser.id, {
        caloriesPerServing: "500",
      });
      const [item] = await tx
        .insert(mealPlanItems)
        .values({
          userId: testUser.id,
          recipeId: recipe.id,
          plannedDate: "2026-05-15",
          mealType: "lunch",
          servings: "1",
        })
        .returning();
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2026-05-15T12:00:00Z"),
        [item.id],
      );
      expect(Number(summary.plannedCalories)).toBe(0);
      expect(Number(summary.plannedItemCount)).toBe(0);
    });

    it("excludes soft-deleted scanned items from the sum", async () => {
      const [scanned] = await tx
        .insert(scannedItems)
        .values({
          userId: testUser.id,
          productName: "Discarded Snack",
          calories: "200",
          discardedAt: new Date(),
        })
        .returning();
      await tx.insert(mealPlanItems).values({
        userId: testUser.id,
        scannedItemId: scanned.id,
        plannedDate: "2026-05-15",
        mealType: "snack",
        servings: "1",
      });
      const summary = await getPlannedNutritionSummary(
        testUser.id,
        new Date("2026-05-15T12:00:00Z"),
        [],
      );
      // Item count still 1 (row exists), but calories should be 0 because
      // the left-join discards the scanned item.
      expect(Number(summary.plannedCalories)).toBe(0);
    });
  });

  describe("getMealPlanIngredientsForDateRange", () => {
    it("returns empty when no meal plan items in range", async () => {
      const ings = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      expect(ings).toEqual([]);
    });

    it("returns ingredients from recipes referenced by meal plan items in range", async () => {
      const recipe = await createRecipe(testUser.id);
      await tx.insert(recipeIngredients).values([
        { recipeId: recipe.id, name: "flour", displayOrder: 0 },
        { recipeId: recipe.id, name: "sugar", displayOrder: 1 },
      ]);
      await tx.insert(mealPlanItems).values({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-16",
        mealType: "dinner",
      });

      const ings = await getMealPlanIngredientsForDateRange(
        testUser.id,
        "2026-05-15",
        "2026-05-22",
      );
      const names = ings.map((i) => i.name).sort();
      expect(names).toEqual(["flour", "sugar"]);
    });
  });

  describe("getFrequentRecipesForMealType", () => {
    it("returns empty when no items match", async () => {
      const recipes = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(recipes).toEqual([]);
    });

    it("returns recipes ordered by usage frequency for the meal type", async () => {
      const recipeA = await createRecipe(testUser.id, { title: "Eggs" });
      const recipeB = await createRecipe(testUser.id, { title: "Oats" });
      // recipeA used twice, recipeB once.
      await tx.insert(mealPlanItems).values([
        {
          userId: testUser.id,
          recipeId: recipeA.id,
          plannedDate: "2026-05-15",
          mealType: "breakfast",
        },
        {
          userId: testUser.id,
          recipeId: recipeA.id,
          plannedDate: "2026-05-16",
          mealType: "breakfast",
        },
        {
          userId: testUser.id,
          recipeId: recipeB.id,
          plannedDate: "2026-05-17",
          mealType: "breakfast",
        },
      ]);
      const result = await getFrequentRecipesForMealType(
        testUser.id,
        "breakfast",
      );
      expect(result.map((r) => r.id)).toEqual([recipeA.id, recipeB.id]);
    });
  });

  describe("getPopularPicksByMealType", () => {
    it("returns empty when no ai_suggestion items exist", async () => {
      const picks = await getPopularPicksByMealType(testUser.id, "dinner");
      expect(picks).toEqual([]);
    });

    it("returns ai_suggestion recipes used by other users, grouped by recipe contents", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createRecipe(otherUser.id, {
        title: "Popular Bowl",
        sourceType: "ai_suggestion",
        caloriesPerServing: "500",
      });
      await tx.insert(mealPlanItems).values({
        userId: otherUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "dinner",
      });

      const picks = await getPopularPicksByMealType(testUser.id, "dinner");
      expect(picks).toHaveLength(1);
      expect(picks[0].title).toBe("Popular Bowl");
      expect(picks[0].pickCount).toBe(1);
    });

    it("excludes the requesting user's own ai_suggestion picks", async () => {
      const recipe = await createRecipe(testUser.id, {
        title: "Own AI Recipe",
        sourceType: "ai_suggestion",
      });
      await tx.insert(mealPlanItems).values({
        userId: testUser.id,
        recipeId: recipe.id,
        plannedDate: "2026-05-15",
        mealType: "dinner",
      });
      const picks = await getPopularPicksByMealType(testUser.id, "dinner");
      expect(picks).toEqual([]);
    });
  });
});
