import { describe, it, expect } from "vitest";
import { extractOffAllergenData } from "../barcode-lookup";

describe("extractOffAllergenData", () => {
  it("extracts tags + text and marks data available on an OFF hit", () => {
    const r = extractOffAllergenData({
      allergens_tags: ["en:milk"],
      ingredients_text: "sugar, milk",
    });
    expect(r.allergenTags).toEqual(["en:milk"]);
    expect(r.ingredientsText).toBe("sugar, milk");
    expect(r.allergenDataAvailable).toBe(true);
  });

  it("prefers the English ingredients text when present", () => {
    const r = extractOffAllergenData({
      ingredients_text: "sucre, lait",
      ingredients_text_en: "sugar, milk",
    });
    expect(r.ingredientsText).toBe("sugar, milk");
  });

  it("data is UNAVAILABLE when OFF missed entirely (null product)", () => {
    const r = extractOffAllergenData(null);
    expect(r.allergenDataAvailable).toBe(false);
    expect(r.allergenTags).toEqual([]);
  });

  it("data is UNAVAILABLE when the OFF product has neither tags nor text", () => {
    const r = extractOffAllergenData({
      allergens_tags: [],
      ingredients_text: "  ",
    });
    expect(r.allergenDataAvailable).toBe(false);
  });

  it("data is UNAVAILABLE when the only tags are out of our 9-allergen model and there is no ingredient text", () => {
    const r = extractOffAllergenData({
      allergens_tags: ["en:mustard"],
      ingredients_text: "",
    });
    expect(r.allergenDataAvailable).toBe(false);
  });

  it("data is AVAILABLE when at least one tag maps to an in-model allergen, even with no ingredient text", () => {
    const r = extractOffAllergenData({
      allergens_tags: ["en:milk"],
      ingredients_text: undefined,
    });
    expect(r.allergenDataAvailable).toBe(true);
  });

  it("falls back to the base-language ingredients text when the English text is whitespace-only", () => {
    const r = extractOffAllergenData({
      ingredients_text_en: "  ",
      ingredients_text: "sugar, milk",
    });
    expect(r.ingredientsText).toBe("sugar, milk");
  });
});
