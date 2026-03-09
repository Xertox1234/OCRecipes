import {
  calculateCookedNutrition,
  preparationToCookingMethod,
  _testInternals,
  type RawNutritionPer100g,
} from "../cooking-adjustment";

const { toFoodGroup, YIELD_FACTORS, MACRO_RETENTION, FAT_ADDITION_PER_100G } =
  _testInternals;

const CHICKEN_RAW: RawNutritionPer100g = {
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: 0,
  sugar: 0,
  sodium: 74,
};

const BROCCOLI_RAW: RawNutritionPer100g = {
  calories: 34,
  protein: 2.8,
  carbs: 7,
  fat: 0.4,
  fiber: 2.6,
  sugar: 1.7,
  sodium: 33,
};

const PASTA_RAW: RawNutritionPer100g = {
  calories: 371,
  protein: 13,
  carbs: 75,
  fat: 1.5,
  fiber: 3.2,
  sugar: 2.7,
  sodium: 6,
};

describe("cooking-adjustment", () => {
  describe("toFoodGroup", () => {
    it("maps protein category to meat_poultry", () => {
      expect(toFoodGroup("protein")).toBe("meat_poultry");
    });

    it("maps vegetable and fruit to vegetables", () => {
      expect(toFoodGroup("vegetable")).toBe("vegetables");
      expect(toFoodGroup("fruit")).toBe("vegetables");
    });

    it("maps grain to grains_pasta", () => {
      expect(toFoodGroup("grain")).toBe("grains_pasta");
    });

    it("maps other categories to other", () => {
      expect(toFoodGroup("dairy")).toBe("other");
      expect(toFoodGroup("other")).toBe("other");
      expect(toFoodGroup("beverage")).toBe("other");
    });
  });

  describe("preparationToCookingMethod", () => {
    it("maps standard preparation strings", () => {
      expect(preparationToCookingMethod("Grilled")).toBe("grilled");
      expect(preparationToCookingMethod("Pan-Fried")).toBe("fried");
      expect(preparationToCookingMethod("Deep-Fried")).toBe("deep-fried");
      expect(preparationToCookingMethod("Baked")).toBe("baked");
      expect(preparationToCookingMethod("Steamed")).toBe("steamed");
      expect(preparationToCookingMethod("Boiled")).toBe("boiled");
      expect(preparationToCookingMethod("Sautéed")).toBe("sauteed");
      expect(preparationToCookingMethod("Stir-Fried")).toBe("stir-fried");
      expect(preparationToCookingMethod("Roasted")).toBe("roasted");
    });

    it("maps As Served and Raw to raw", () => {
      expect(preparationToCookingMethod("As Served")).toBe("raw");
      expect(preparationToCookingMethod("Raw")).toBe("raw");
    });

    it("defaults unknown preparations to raw", () => {
      expect(preparationToCookingMethod("Unknown Method")).toBe("raw");
      expect(preparationToCookingMethod("")).toBe("raw");
    });
  });

  describe("calculateCookedNutrition", () => {
    it("returns raw nutrition unchanged when method is raw", () => {
      const result = calculateCookedNutrition(
        CHICKEN_RAW,
        200,
        "protein",
        "raw",
      );

      expect(result.adjustmentApplied).toBe(false);
      expect(result.cookingMethod).toBe("raw");
      expect(result.cookedWeightG).toBe(200);
      // 165 cal per 100g × 2 = 330
      expect(result.calories).toBe(330);
      expect(result.protein).toBe(62);
    });

    it("reduces weight for grilled chicken (moisture loss)", () => {
      const result = calculateCookedNutrition(
        CHICKEN_RAW,
        200,
        "protein",
        "grilled",
      );

      expect(result.adjustmentApplied).toBe(true);
      expect(result.cookedWeightG).toBeLessThan(200);
      // Grilled meat yield is 0.72
      expect(result.cookedWeightG).toBe(Math.round(200 * 0.72));
    });

    it("increases weight for boiled pasta (water absorption)", () => {
      const result = calculateCookedNutrition(
        PASTA_RAW,
        100,
        "grain",
        "boiled",
      );

      expect(result.adjustmentApplied).toBe(true);
      expect(result.cookedWeightG).toBeGreaterThan(100);
      // Boiled grains yield is 2.0
      expect(result.cookedWeightG).toBe(Math.round(100 * 2.0));
    });

    it("adds fat for fried foods", () => {
      const rawResult = calculateCookedNutrition(
        BROCCOLI_RAW,
        200,
        "vegetable",
        "raw",
      );
      const friedResult = calculateCookedNutrition(
        BROCCOLI_RAW,
        200,
        "vegetable",
        "deep-fried",
      );

      // Deep frying adds 12g fat per 100g → 24g for 200g
      expect(friedResult.fat).toBeGreaterThan(rawResult.fat);
    });

    it("applies retention factors to macros", () => {
      const rawResult = calculateCookedNutrition(
        CHICKEN_RAW,
        100,
        "protein",
        "raw",
      );
      const boiledResult = calculateCookedNutrition(
        CHICKEN_RAW,
        100,
        "protein",
        "boiled",
      );

      // Boiled meat loses protein (0.9 retention) and fat (0.75 retention)
      expect(boiledResult.protein).toBeLessThan(rawResult.protein);
      expect(boiledResult.fat).toBeLessThan(rawResult.fat);
      expect(boiledResult.calories).toBeLessThan(rawResult.calories);
    });

    it("rounds values correctly", () => {
      const result = calculateCookedNutrition(
        CHICKEN_RAW,
        150,
        "protein",
        "grilled",
      );

      // Calories should be integer
      expect(Number.isInteger(result.calories)).toBe(true);
      // Sodium should be integer
      expect(Number.isInteger(result.sodium)).toBe(true);
      // Macros should have at most 1 decimal place
      expect(result.protein).toBe(Math.round(result.protein * 10) / 10);
      expect(result.fat).toBe(Math.round(result.fat * 10) / 10);
    });

    it("handles zero-weight input", () => {
      const result = calculateCookedNutrition(
        CHICKEN_RAW,
        0,
        "protein",
        "grilled",
      );

      expect(result.calories).toBe(0);
      expect(result.protein).toBe(0);
      expect(result.cookedWeightG).toBe(0);
    });
  });

  describe("data tables", () => {
    it("has raw yield factor of 1.0 for all food groups", () => {
      for (const group of Object.keys(YIELD_FACTORS)) {
        expect(YIELD_FACTORS[group as keyof typeof YIELD_FACTORS].raw).toBe(
          1.0,
        );
      }
    });

    it("has raw retention of 1.0 for all macros in all food groups", () => {
      for (const group of Object.keys(MACRO_RETENTION)) {
        const raw = MACRO_RETENTION[group as keyof typeof MACRO_RETENTION].raw;
        expect(raw).toEqual({
          protein: 1.0,
          fat: 1.0,
          carbs: 1.0,
          calories: 1.0,
        });
      }
    });

    it("only adds fat for frying methods", () => {
      const fatMethods = Object.keys(FAT_ADDITION_PER_100G);
      for (const method of fatMethods) {
        expect(["fried", "deep-fried", "sauteed", "stir-fried"]).toContain(
          method,
        );
      }
    });
  });
});
