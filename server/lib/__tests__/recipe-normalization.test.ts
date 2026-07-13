import { describe, it, expect } from "vitest";
import {
  normalizeTitle,
  normalizeDescription,
  normalizeDifficulty,
  normalizeInstructions,
  normalizeIngredient,
  normalizeUnit,
  normalizeRecipeFields,
} from "../recipe-normalization";

describe("normalizeTitle", () => {
  it("converts to title case", () => {
    expect(normalizeTitle("chicken parmesan")).toBe("Chicken Parmesan");
  });
  it("handles already title-cased input", () => {
    expect(normalizeTitle("Chicken Parmesan")).toBe("Chicken Parmesan");
  });
  it("handles ALL CAPS", () => {
    expect(normalizeTitle("CHICKEN PARMESAN")).toBe("Chicken Parmesan");
  });
  it("preserves short words in the middle", () => {
    expect(normalizeTitle("toast with butter and jam")).toBe(
      "Toast with Butter and Jam",
    );
  });
  it("trims whitespace", () => {
    expect(normalizeTitle("  chicken parmesan  ")).toBe("Chicken Parmesan");
  });
});

describe("normalizeDescription", () => {
  it("capitalizes the first letter", () => {
    expect(normalizeDescription("a delicious meal")).toBe("A delicious meal.");
  });
  it("adds trailing period if missing", () => {
    expect(normalizeDescription("A delicious meal")).toBe("A delicious meal.");
  });
  it("does not double-add period", () => {
    expect(normalizeDescription("A delicious meal.")).toBe("A delicious meal.");
  });
  it("does not add period after question mark", () => {
    expect(normalizeDescription("Ready for dinner?")).toBe("Ready for dinner?");
  });
  it("does not add period after exclamation mark", () => {
    expect(normalizeDescription("So tasty!")).toBe("So tasty!");
  });
  it("returns null for empty/whitespace input", () => {
    expect(normalizeDescription("")).toBeNull();
    expect(normalizeDescription("   ")).toBeNull();
  });
  it("returns null for null input", () => {
    expect(normalizeDescription(null)).toBeNull();
  });
});

describe("normalizeDifficulty", () => {
  it('maps "easy" to "Easy"', () => {
    expect(normalizeDifficulty("easy")).toBe("Easy");
  });
  it('maps "beginner" to "Easy"', () => {
    expect(normalizeDifficulty("beginner")).toBe("Easy");
  });
  it('maps "medium" to "Medium"', () => {
    expect(normalizeDifficulty("medium")).toBe("Medium");
  });
  it('maps "moderate" to "Medium"', () => {
    expect(normalizeDifficulty("moderate")).toBe("Medium");
  });
  it('maps "hard" to "Hard"', () => {
    expect(normalizeDifficulty("hard")).toBe("Hard");
  });
  it('maps "advanced" to "Hard"', () => {
    expect(normalizeDifficulty("advanced")).toBe("Hard");
  });
  it("returns null for unrecognized input", () => {
    expect(normalizeDifficulty("impossible")).toBeNull();
  });
  it("returns null for null/undefined input", () => {
    expect(normalizeDifficulty(null)).toBeNull();
    expect(normalizeDifficulty(undefined)).toBeNull();
  });
});

describe("normalizeInstructions", () => {
  it("strips leading numbering", () => {
    expect(
      normalizeInstructions(["1. Preheat oven", "2. Season chicken"]),
    ).toEqual(["Preheat oven", "Season chicken"]);
  });
  it("strips 'Step N:' prefix", () => {
    expect(normalizeInstructions(["Step 1: Preheat oven"])).toEqual([
      "Preheat oven",
    ]);
  });
  it("capitalizes first letter", () => {
    expect(normalizeInstructions(["preheat oven"])).toEqual(["Preheat oven"]);
  });
  it("trims whitespace", () => {
    expect(normalizeInstructions(["  preheat oven  "])).toEqual([
      "Preheat oven",
    ]);
  });
  it("filters out empty steps", () => {
    expect(normalizeInstructions(["Preheat", "", "  ", "Season"])).toEqual([
      "Preheat",
      "Season",
    ]);
  });
  it("returns empty array for null input", () => {
    expect(normalizeInstructions(null)).toEqual([]);
  });
});

describe("normalizeUnit", () => {
  it('normalizes "tablespoon" to "tbsp"', () => {
    expect(normalizeUnit("tablespoon")).toBe("tbsp");
  });
  it('normalizes "Tbsp" to "tbsp"', () => {
    expect(normalizeUnit("Tbsp")).toBe("tbsp");
  });
  it('normalizes "tablespoons" to "tbsp"', () => {
    expect(normalizeUnit("tablespoons")).toBe("tbsp");
  });
  it('normalizes "teaspoon" to "tsp"', () => {
    expect(normalizeUnit("teaspoon")).toBe("tsp");
  });
  it('normalizes "ounce" to "oz"', () => {
    expect(normalizeUnit("ounce")).toBe("oz");
  });
  it('normalizes "ounces" to "oz"', () => {
    expect(normalizeUnit("ounces")).toBe("oz");
  });
  it('normalizes "pound" to "lb"', () => {
    expect(normalizeUnit("pound")).toBe("lb");
  });
  it('normalizes "pounds" to "lb"', () => {
    expect(normalizeUnit("pounds")).toBe("lb");
  });
  it('normalizes "cups" to "cup"', () => {
    expect(normalizeUnit("cups")).toBe("cup");
  });
  it("passes through unknown units unchanged (lowercased)", () => {
    expect(normalizeUnit("pinch")).toBe("pinch");
  });
  it("returns empty string for null/undefined", () => {
    expect(normalizeUnit(null)).toBe("");
    expect(normalizeUnit(undefined)).toBe("");
  });
});

describe("normalizeIngredient", () => {
  it("title-cases the name", () => {
    const result = normalizeIngredient({
      name: "chicken breast",
      quantity: "2",
      unit: "lb",
    });
    expect(result.name).toBe("Chicken Breast");
  });
  it("normalizes the unit", () => {
    const result = normalizeIngredient({
      name: "Flour",
      quantity: "2",
      unit: "cups",
    });
    expect(result.unit).toBe("cup");
  });
  it("splits measurement from name field when quantity/unit are empty", () => {
    const result = normalizeIngredient({
      name: "2 cups diced tomatoes",
      quantity: "",
      unit: "",
    });
    expect(result.quantity).toBe("2");
    expect(result.unit).toBe("cup");
    expect(result.name).toBe("Diced Tomatoes");
  });
  it("splits fractional measurement from name field and converts it to decimal", () => {
    const result = normalizeIngredient({
      name: "1/2 tsp salt",
      quantity: "",
      unit: "",
    });
    expect(result.quantity).toBe("0.5");
    expect(result.unit).toBe("tsp");
    expect(result.name).toBe("Salt");
  });

  it("converts a unicode fraction glyph quantity to decimal", () => {
    const result = normalizeIngredient({
      name: "Flour",
      quantity: "½",
      unit: "cup",
    });
    expect(result.quantity).toBe("0.5");
  });

  it("preserves freeform (non-numeric) quantity text unchanged", () => {
    const result = normalizeIngredient({
      name: "Salt",
      quantity: "a pinch",
      unit: "",
    });
    expect(result.quantity).toBe("a pinch");
  });
  it("does not split if quantity is already provided", () => {
    const result = normalizeIngredient({
      name: "2 cups flour",
      quantity: "3",
      unit: "tbsp",
    });
    expect(result.quantity).toBe("3");
    expect(result.unit).toBe("tbsp");
    expect(result.name).toBe("2 Cups Flour");
  });
});

describe("normalizeRecipeFields", () => {
  it("normalizes title (always present)", () => {
    expect(normalizeRecipeFields({ title: "chicken parmesan" }).title).toBe(
      "Chicken Parmesan",
    );
  });

  it("returns null description when the input is empty/null (caller applies fallback)", () => {
    expect(
      normalizeRecipeFields({ title: "x", description: null }).description,
    ).toBeNull();
    expect(
      normalizeRecipeFields({ title: "x", description: "" }).description,
    ).toBeNull();
  });

  it("normalizes a non-empty description", () => {
    expect(
      normalizeRecipeFields({ title: "x", description: "a tasty meal" })
        .description,
    ).toBe("A tasty meal.");
  });

  it("omits the description key entirely when not provided", () => {
    const result = normalizeRecipeFields({ title: "x" });
    expect("description" in result).toBe(false);
  });

  it("returns null difficulty for an unknown value (caller applies fallback)", () => {
    expect(
      normalizeRecipeFields({ title: "x", difficulty: "nonsense" }).difficulty,
    ).toBeNull();
    expect(
      normalizeRecipeFields({ title: "x", difficulty: "simple" }).difficulty,
    ).toBe("Easy");
  });

  it("preserves an absent instructions value as null (does not coerce to [])", () => {
    // meal-plan's no-instructions path relies on this: instructions undefined
    // must stay undefined, not become [].
    expect(
      normalizeRecipeFields({ title: "x", instructions: undefined })
        .instructions,
    ).toBeUndefined();
    expect(
      normalizeRecipeFields({ title: "x", instructions: null }).instructions,
    ).toBeNull();
  });

  it("omits the instructions key entirely when not provided", () => {
    const result = normalizeRecipeFields({ title: "x" });
    expect("instructions" in result).toBe(false);
  });

  it("normalizes a provided instructions array", () => {
    expect(
      normalizeRecipeFields({
        title: "x",
        instructions: ["1. preheat oven", "2. season chicken"],
      }).instructions,
    ).toEqual(["Preheat oven", "Season chicken"]);
  });

  it("normalizes ingredients, defaulting missing quantity/unit to empty strings", () => {
    const result = normalizeRecipeFields({
      title: "x",
      ingredients: [
        { name: "chicken breast", quantity: "2", unit: "pounds" },
        { name: "1/2 tsp salt" },
      ],
    });
    expect(result.ingredients).toEqual([
      { name: "Chicken Breast", quantity: "2", unit: "lb" },
      { name: "Salt", quantity: "0.5", unit: "tsp" },
    ]);
  });

  it("omits the ingredients key when ingredients is null/undefined", () => {
    expect("ingredients" in normalizeRecipeFields({ title: "x" })).toBe(false);
    expect(
      "ingredients" in
        normalizeRecipeFields({ title: "x", ingredients: undefined }),
    ).toBe(false);
    expect(
      "ingredients" in normalizeRecipeFields({ title: "x", ingredients: null }),
    ).toBe(false);
  });

  it("returns an empty ingredients array for an empty input array", () => {
    expect(
      normalizeRecipeFields({ title: "x", ingredients: [] }).ingredients,
    ).toEqual([]);
  });

  it("omits the title key entirely when not provided, without throwing", () => {
    const result = normalizeRecipeFields({ difficulty: "easy" });
    expect("title" in result).toBe(false);
    expect(result.difficulty).toBe("Easy");
  });

  it("does not throw when title is absent (partial-update case)", () => {
    expect(() => normalizeRecipeFields({ description: "test" })).not.toThrow();
  });
});
