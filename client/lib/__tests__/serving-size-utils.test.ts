import { describe, it, expect } from "vitest";
import {
  parseServingGrams,
  isMultiPackProduct,
  checkServingPlausibility,
  validateAndNormalizeNutrition,
  scaleNutrition,
  estimateReasonableServingGrams,
  getServingSizeOptions,
} from "../serving-size-utils";

describe("parseServingGrams", () => {
  it("parses simple gram values", () => {
    expect(parseServingGrams("15g")).toBe(15);
    expect(parseServingGrams("236.0g")).toBe(236);
    expect(parseServingGrams("100 g")).toBe(100);
  });

  it("parses grams from parenthesized expressions", () => {
    expect(parseServingGrams("1 pod (15g)")).toBe(15);
    expect(parseServingGrams("2 cups (473ml)")).toBe(473);
  });

  it("parses ml values", () => {
    expect(parseServingGrams("250ml")).toBe(250);
    expect(parseServingGrams("1 cup (240 ml)")).toBe(240);
  });

  it("returns null for unparseable strings", () => {
    expect(parseServingGrams("")).toBeNull();
    expect(parseServingGrams("1 serving")).toBeNull();
    expect(parseServingGrams("unknown")).toBeNull();
  });
});

describe("isMultiPackProduct", () => {
  it("detects K-cup/pod products", () => {
    expect(isMultiPackProduct("Keurig K-Cup Hot Chocolate Pods")).toBe(true);
    expect(isMultiPackProduct("Victor Allen's Coffee Pod")).toBe(true);
    expect(isMultiPackProduct("K-Cups Variety Pack")).toBe(true);
  });

  it("detects multi-pack keywords", () => {
    expect(isMultiPackProduct("Granola Bars 6 Pack")).toBe(true);
    expect(isMultiPackProduct("Yogurt Multi-Pack")).toBe(true);
    expect(isMultiPackProduct("12 Count Muffins")).toBe(true);
  });

  it("returns false for single-serving items", () => {
    expect(isMultiPackProduct("Chocolate Milk")).toBe(false);
    expect(isMultiPackProduct("Banana")).toBe(false);
    expect(isMultiPackProduct("Greek Yogurt")).toBe(false);
  });
});

describe("checkServingPlausibility", () => {
  it("flags impossibly high calories per serving", () => {
    // The Keurig hot chocolate bug: 944 cal for a pod
    const result = checkServingPlausibility(
      944,
      236,
      400,
      "Hot Chocolate Pods",
    );
    expect(result.isPlausible).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("accepts normal calorie values", () => {
    // A reasonable meal: 500 cal, 200g serving, 250 cal/100g
    const result = checkServingPlausibility(500, 200, 250, "Pasta");
    expect(result.isPlausible).toBe(true);
  });

  it("flags when serving is larger than 500g", () => {
    // params: caloriesPerServing, caloriesPer100g, servingGrams, productName
    const result = checkServingPlausibility(400, 66, 600, "Soup");
    expect(result.isPlausible).toBe(false);
  });

  it("flags multi-pack products with high calorie ratios", () => {
    // Multi-pack: ratio = 400/100 = 4.0 > MAX_SERVING_TO_100G_CALORIE_RATIO (3.0)
    const result = checkServingPlausibility(
      400,
      100,
      200,
      "Granola Bars 6-Pack",
    );
    expect(result.isPlausible).toBe(false);
  });
});

describe("validateAndNormalizeNutrition", () => {
  it("corrects the Keurig hot chocolate bug", () => {
    // Real Open Food Facts data for the problematic product
    const product = {
      product_name: "Laura Secord Hot Chocolate K-Cups",
      brands: "Laura Secord",
      serving_size: "236.0g",
      serving_quantity: "236",
      nutriments: {
        "energy-kcal_100g": 400,
        "energy-kcal_serving": 944,
        proteins_100g: 8.47,
        proteins_serving: 20,
        carbohydrates_100g: 72.03,
        carbohydrates_serving: 170,
        fat_100g: 8.47,
        fat_serving: 20,
        sugars_100g: 59.32,
        sugars_serving: 140,
        fiber_100g: 4.2,
        fiber_serving: 10,
        sodium_100g: 0.508,
        sodium_serving: 1.2,
      },
    };

    const result = validateAndNormalizeNutrition(product, "0663447217174");

    // Serving should be corrected — calories should be much less than 944
    expect(result.servingInfo.wasCorrected).toBe(true);
    expect(result.perServing.calories).toBeLessThan(200);
    // Per 100g should remain untouched
    expect(result.per100g.calories).toBe(400);
  });

  it("passes through correctly-entered products untouched", () => {
    // Victor Allen's Hot Chocolate — correct data: 15g serving, ~70 cal
    const product = {
      product_name: "Victor Allen's Hot Chocolate",
      brands: "Victor Allen's",
      serving_size: "15g",
      serving_quantity: "15",
      nutriments: {
        "energy-kcal_100g": 467,
        "energy-kcal_serving": 70,
        proteins_100g: 6.67,
        proteins_serving: 1,
        carbohydrates_100g: 73.33,
        carbohydrates_serving: 11,
        fat_100g: 13.33,
        fat_serving: 2,
        sugars_100g: 53.33,
        sugars_serving: 8,
      },
    };

    const result = validateAndNormalizeNutrition(product, "0099555086007");

    expect(result.servingInfo.wasCorrected).toBe(false);
    // Calories per serving should be approximately 70
    expect(result.perServing.calories).toBeCloseTo(70, 0);
    expect(result.per100g.calories).toBe(467);
  });

  it("handles products with only per-100g data", () => {
    const product = {
      product_name: "Generic Cereal",
      nutriments: {
        "energy-kcal_100g": 380,
        proteins_100g: 8,
        carbohydrates_100g: 75,
        fat_100g: 5,
      },
    };

    const result = validateAndNormalizeNutrition(product, "1234567890");

    // With no serving info, per-serving should equal per-100g
    expect(result.per100g.calories).toBe(380);
    expect(result.isServingDataTrusted).toBe(false);
  });
});

describe("scaleNutrition", () => {
  it("scales all fields by the given factor", () => {
    const base = {
      calories: 400,
      protein: 10,
      carbs: 60,
      fat: 15,
      fiber: 5,
      sugar: 30,
      sodium: 500,
    };

    const scaled = scaleNutrition(base, 0.15);

    expect(scaled.calories).toBeCloseTo(60, 0);
    expect(scaled.protein).toBeCloseTo(1.5, 1);
    expect(scaled.carbs).toBeCloseTo(9, 0);
    expect(scaled.fat).toBeCloseTo(2.25, 1);
    expect(scaled.fiber).toBeCloseTo(0.75, 1);
    expect(scaled.sugar).toBeCloseTo(4.5, 1);
    expect(scaled.sodium).toBeCloseTo(75, 0);
  });

  it("handles undefined fields gracefully", () => {
    const base = {
      calories: 200,
      protein: 5,
      carbs: 30,
      fat: 8,
    };

    const scaled = scaleNutrition(base, 2);
    expect(scaled.calories).toBe(400);
    expect(scaled.fiber).toBeUndefined();
    expect(scaled.sugar).toBeUndefined();
  });
});

describe("estimateReasonableServingGrams", () => {
  it("returns pod-sized serving for K-cup products", () => {
    const grams = estimateReasonableServingGrams("Hot Chocolate K-Cups", 400);
    expect(grams).toBe(15);
  });

  it("returns bar-sized serving for bar products", () => {
    const grams = estimateReasonableServingGrams("Protein Bar", 450);
    expect(grams).toBe(40);
  });

  it("uses calorie density for generic products", () => {
    // High-calorie-density product (like nuts) → smaller serving
    const highCal = estimateReasonableServingGrams("Mixed Nuts", 600);
    // Low-calorie-density product (like vegetables) → larger serving
    const lowCal = estimateReasonableServingGrams("Vegetable Soup", 40);

    expect(highCal).toBeLessThan(lowCal);
  });
});

describe("getServingSizeOptions", () => {
  it("returns serving options including the product serving and common sizes", () => {
    const options = getServingSizeOptions(
      {
        grams: 15,
        displayLabel: "1 pod (15g)",
        wasCorrected: false,
      },
      "Hot Chocolate Pods",
    );

    // Should include the product serving (15g)
    expect(options.some((o) => o.grams === 15)).toBe(true);
    // Should include a 100g option
    expect(options.some((o) => o.grams === 100)).toBe(true);
    // Should include common household measurements
    expect(options.some((o) => o.grams === 4)).toBe(true); // 1 tsp
    expect(options.some((o) => o.grams === 12)).toBe(true); // 1 tbsp
  });

  it("marks the product serving as default", () => {
    const options = getServingSizeOptions(
      {
        grams: 4,
        displayLabel: "4g",
        wasCorrected: false,
      },
      "Sugar",
    );

    const defaultOpt = options.find((o) => o.isDefault);
    expect(defaultOpt).toBeDefined();
    expect(defaultOpt!.grams).toBe(4);
  });

  it("deduplicates gram values", () => {
    // If the product serving is already 4g, the "1 tsp (4g)" option
    // shouldn't create a duplicate
    const options = getServingSizeOptions(
      {
        grams: 4,
        displayLabel: "1 tsp (4g)",
        wasCorrected: false,
      },
      "Sugar",
    );

    const fourGramOptions = options.filter((o) => o.grams === 4);
    expect(fourGramOptions).toHaveLength(1);
  });

  it("marks 100g as default when no product serving exists", () => {
    const options = getServingSizeOptions(
      {
        grams: null,
        displayLabel: "100g",
        wasCorrected: false,
      },
      "Unknown Item",
    );

    const defaultOpt = options.find((o) => o.isDefault);
    expect(defaultOpt).toBeDefined();
    expect(defaultOpt!.grams).toBe(100);
  });
});
