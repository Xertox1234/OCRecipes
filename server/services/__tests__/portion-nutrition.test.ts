import { nutrientValues, scaleToGrams } from "../portion-nutrition";
import type { NutritionData } from "../nutrition-lookup";

function result(overrides: Partial<NutritionData> = {}): NutritionData {
  return {
    name: "Carbonated drinks, cola",
    calories: 40,
    protein: 1,
    carbs: 10,
    fat: 2,
    fiber: 3,
    sugar: 8,
    sodium: 4,
    servingSize: "100g",
    source: "cnf",
    ...overrides,
  };
}

describe("scaleToGrams", () => {
  it("scales all seven nutrients of a per-100 g result", () => {
    expect(scaleToGrams(result(), 250)).toEqual({
      calories: 100,
      protein: 2.5,
      carbs: 25,
      fat: 5,
      fiber: 7.5,
      sugar: 20,
      sodium: 10,
    });
  });

  it("normalizes a per-serving basis first, so it is never scaled twice", () => {
    // API Ninjas answers per serving: 120 kcal in 240 g is 50 kcal per 100 g.
    const perServing = result({ calories: 120, servingSize: "240g" });
    expect(scaleToGrams(perServing, 240)?.calories).toBe(120);
    expect(scaleToGrams(perServing, 100)?.calories).toBe(50);
  });

  it("reads a millilitre basis as grams", () => {
    expect(scaleToGrams(result({ servingSize: "200 ml" }), 400)?.calories).toBe(
      80,
    );
  });

  it("returns null when the basis cannot be weighed", () => {
    expect(scaleToGrams(result({ servingSize: "1 serving" }), 355)).toBeNull();
    expect(scaleToGrams(result({ servingSize: "12 fl oz" }), 355)).toBeNull();
    expect(scaleToGrams(result({ servingSize: "" }), 355)).toBeNull();
    // A zero basis (a premium-gated API Ninjas serving_size_g coerces to 0)
    expect(scaleToGrams(result({ servingSize: "0g" }), 355)).toBeNull();
  });

  it("keeps a non-numeric value as null rather than zero", () => {
    const cached = result({ fiber: "n/a" as unknown as number });
    expect(scaleToGrams(cached, 100)?.fiber).toBeNull();
  });
});

describe("nutrientValues", () => {
  it("returns the result's seven values unscaled", () => {
    expect(
      nutrientValues(result({ calories: "41" as unknown as number })),
    ).toEqual({
      calories: 41,
      protein: 1,
      carbs: 10,
      fat: 2,
      fiber: 3,
      sugar: 8,
      sodium: 4,
    });
  });
});
