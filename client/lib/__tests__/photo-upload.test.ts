import { describe, it, expect, vi } from "vitest";

/**
 * We only test the pure `calculateTotals` function here.
 * The other exports (uploadPhoto, confirmPhoto) depend on expo-file-system
 * and other native modules, which are tested via integration tests.
 *
 * Mock all native-dependent imports to allow importing calculateTotals.
 */
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: vi.fn(),
  FileSystemUploadType: { MULTIPART: 0 },
}));

vi.mock("../token-storage", () => ({
  tokenStorage: { get: vi.fn() },
}));

vi.mock("../query-client", () => ({
  getApiUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("../image-compression", () => ({
  compressImage: vi.fn(),
  cleanupImage: vi.fn(),
}));

import { calculateTotals, type FoodItem } from "../photo-upload";

describe("calculateTotals", () => {
  const baseNutrition = {
    name: "Chicken",
    fiber: 0,
    sugar: 0,
    sodium: 100,
    servingSize: "100g",
    source: "usda" as const,
  };

  it("sums nutrition from multiple food items", () => {
    const foods: FoodItem[] = [
      {
        name: "Chicken",
        quantity: "200g",
        confidence: 0.9,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
        },
      },
      {
        name: "Rice",
        quantity: "1 cup",
        confidence: 0.85,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          name: "Rice",
          calories: 216,
          protein: 5,
          carbs: 45,
          fat: 2,
        },
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(546);
    expect(result.protein).toBe(67);
    expect(result.carbs).toBe(45);
    expect(result.fat).toBe(9);
  });

  it("skips items without nutrition data", () => {
    const foods: FoodItem[] = [
      {
        name: "Chicken",
        quantity: "200g",
        confidence: 0.9,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
        },
      },
      {
        name: "Unknown item",
        quantity: "1 serving",
        confidence: 0.3,
        needsClarification: true,
        nutrition: null,
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(330);
    expect(result.protein).toBe(62);
  });

  it("returns zeros for empty array", () => {
    const result = calculateTotals([]);
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("returns zeros when all items lack nutrition", () => {
    const foods: FoodItem[] = [
      {
        name: "Mystery food",
        quantity: "1 piece",
        confidence: 0.2,
        needsClarification: true,
        nutrition: null,
      },
    ];

    const result = calculateTotals(foods);
    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("handles single item", () => {
    const foods: FoodItem[] = [
      {
        name: "Apple",
        quantity: "1 medium",
        confidence: 0.95,
        needsClarification: false,
        nutrition: {
          ...baseNutrition,
          name: "Apple",
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
        },
      },
    ];

    const result = calculateTotals(foods);
    expect(result.calories).toBe(95);
    expect(result.protein).toBe(0.5);
    expect(result.carbs).toBe(25);
    expect(result.fat).toBe(0.3);
  });
});
