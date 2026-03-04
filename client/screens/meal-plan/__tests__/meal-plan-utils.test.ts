import { describe, it, expect } from "vitest";
import {
  getAutoExpandedMealType,
  computeItemMacros,
  computeMealSectionSummary,
  formatMacroLine,
} from "../meal-plan-utils";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import type { MealPlanRecipe, ScannedItem } from "@shared/schema";

/** Minimal item factory — only the fields consumed by the utility functions. */
function makeItem(
  overrides: Record<string, unknown> = {},
): MealPlanItemWithRelations {
  return {
    id: 1,
    userId: "user-1",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-03-04",
    mealType: "breakfast",
    servings: "1",
    sortOrder: 0,
    createdAt: new Date(),
    recipe: null,
    scannedItem: null,
    ...overrides,
  } as MealPlanItemWithRelations;
}

function makeRecipe(overrides: Record<string, unknown> = {}): MealPlanRecipe {
  return {
    id: 1,
    userId: "user-1",
    title: "Test Recipe",
    description: null,
    sourceType: "user_created",
    sourceUrl: null,
    externalId: null,
    cuisine: null,
    difficulty: null,
    servings: 1,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    instructions: null,
    dietTags: [],
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    fiberPerServing: null,
    sugarPerServing: null,
    sodiumPerServing: null,
    imageUrl: null,
    spoonacularId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MealPlanRecipe;
}

function makeScannedItem(overrides: Record<string, unknown> = {}): ScannedItem {
  return {
    id: 1,
    userId: "user-1",
    barcode: null,
    productName: "Test Product",
    brandName: null,
    servingSize: null,
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    sugar: null,
    sodium: null,
    imageUrl: null,
    sourceType: "barcode",
    photoUrl: null,
    aiConfidence: null,
    preparationMethods: null,
    analysisIntent: null,
    scannedAt: new Date(),
    ...overrides,
  } as ScannedItem;
}

describe("getAutoExpandedMealType", () => {
  it("returns breakfast before 11am", () => {
    expect(getAutoExpandedMealType(0)).toBe("breakfast");
    expect(getAutoExpandedMealType(7)).toBe("breakfast");
    expect(getAutoExpandedMealType(10)).toBe("breakfast");
  });

  it("returns lunch from 11 to 13", () => {
    expect(getAutoExpandedMealType(11)).toBe("lunch");
    expect(getAutoExpandedMealType(13)).toBe("lunch");
  });

  it("returns snack from 14 to 16", () => {
    expect(getAutoExpandedMealType(14)).toBe("snack");
    expect(getAutoExpandedMealType(16)).toBe("snack");
  });

  it("returns dinner at 17 and after", () => {
    expect(getAutoExpandedMealType(17)).toBe("dinner");
    expect(getAutoExpandedMealType(23)).toBe("dinner");
  });
});

describe("computeItemMacros", () => {
  it("returns null for orphaned items", () => {
    expect(computeItemMacros(makeItem())).toBeNull();
  });

  it("computes macros from recipe", () => {
    const item = makeItem({
      recipeId: 1,
      recipe: makeRecipe({
        caloriesPerServing: "350",
        proteinPerServing: "28",
        carbsPerServing: "30",
        fatPerServing: "12",
      }),
    });
    expect(computeItemMacros(item)).toEqual({
      calories: 350,
      protein: 28,
      carbs: 30,
      fat: 12,
    });
  });

  it("multiplies by servings for recipe", () => {
    const item = makeItem({
      servings: "2",
      recipeId: 1,
      recipe: makeRecipe({
        caloriesPerServing: "200",
        proteinPerServing: "6",
        carbsPerServing: "35",
        fatPerServing: "4",
      }),
    });
    expect(computeItemMacros(item)).toEqual({
      calories: 400,
      protein: 12,
      carbs: 70,
      fat: 8,
    });
  });

  it("computes macros from scannedItem", () => {
    const item = makeItem({
      scannedItemId: 1,
      scannedItem: makeScannedItem({
        calories: "150",
        protein: "10",
        carbs: "20",
        fat: "3",
      }),
    });
    expect(computeItemMacros(item)).toEqual({
      calories: 150,
      protein: 10,
      carbs: 20,
      fat: 3,
    });
  });

  it("multiplies by servings for scannedItem", () => {
    const item = makeItem({
      servings: "1.5",
      scannedItemId: 1,
      scannedItem: makeScannedItem({
        calories: "200",
        protein: "20",
        carbs: "24",
        fat: "8",
      }),
    });
    expect(computeItemMacros(item)).toEqual({
      calories: 300,
      protein: 30,
      carbs: 36,
      fat: 12,
    });
  });

  it("handles null macro values on recipe", () => {
    const item = makeItem({ recipeId: 1, recipe: makeRecipe() });
    expect(computeItemMacros(item)).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });

  it("defaults servings to 1 when null", () => {
    const item = makeItem({
      servings: null,
      recipeId: 1,
      recipe: makeRecipe({
        caloriesPerServing: "100",
        proteinPerServing: "3",
        carbsPerServing: "18",
        fatPerServing: "2",
      }),
    });
    expect(computeItemMacros(item)).toEqual({
      calories: 100,
      protein: 3,
      carbs: 18,
      fat: 2,
    });
  });

  it("prefers recipe over scannedItem when both present", () => {
    const item = makeItem({
      recipeId: 1,
      scannedItemId: 1,
      recipe: makeRecipe({ caloriesPerServing: "500" }),
      scannedItem: makeScannedItem({ calories: "100" }),
    });
    expect(computeItemMacros(item)?.calories).toBe(500);
  });
});

describe("computeMealSectionSummary", () => {
  it("returns zero for empty items", () => {
    expect(computeMealSectionSummary([])).toEqual({
      itemCount: 0,
      totalCalories: 0,
    });
  });

  it("sums calories across multiple items", () => {
    const items = [
      makeItem({
        recipeId: 1,
        recipe: makeRecipe({ caloriesPerServing: "300" }),
      }),
      makeItem({
        id: 2,
        recipeId: 2,
        recipe: makeRecipe({ id: 2, caloriesPerServing: "250" }),
      }),
    ];
    expect(computeMealSectionSummary(items)).toEqual({
      itemCount: 2,
      totalCalories: 550,
    });
  });

  it("ignores orphaned items in calorie total", () => {
    const items = [
      makeItem({
        recipeId: 1,
        recipe: makeRecipe({ caloriesPerServing: "400" }),
      }),
      makeItem({ id: 2 }), // orphaned
    ];
    expect(computeMealSectionSummary(items)).toEqual({
      itemCount: 2,
      totalCalories: 400,
    });
  });
});

describe("formatMacroLine", () => {
  it("formats macros into compact string", () => {
    expect(
      formatMacroLine({ calories: 350, protein: 12, carbs: 45, fat: 8 }),
    ).toBe("350 cal \u00B7 12g P \u00B7 45g C \u00B7 8g F");
  });

  it("handles zero values", () => {
    expect(formatMacroLine({ calories: 0, protein: 0, carbs: 0, fat: 0 })).toBe(
      "0 cal \u00B7 0g P \u00B7 0g C \u00B7 0g F",
    );
  });
});
