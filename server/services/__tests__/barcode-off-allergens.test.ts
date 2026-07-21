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
});
