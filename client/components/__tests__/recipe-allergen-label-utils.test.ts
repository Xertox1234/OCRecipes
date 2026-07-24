import { describe, it, expect } from "vitest";
import { toRecipeAllergenLabels } from "../recipe-allergen-label-utils";

describe("recipe-allergen-label-utils", () => {
  describe("toRecipeAllergenLabels", () => {
    it("returns an empty array for null (fail-dangerous: never synthesizes a safe value)", () => {
      expect(toRecipeAllergenLabels(null)).toEqual([]);
    });

    it("returns an empty array for undefined", () => {
      expect(toRecipeAllergenLabels(undefined)).toEqual([]);
    });

    it("returns an empty array for an empty array", () => {
      expect(toRecipeAllergenLabels([])).toEqual([]);
    });

    it("maps derived allergens to id + label, preserving input order", () => {
      const result = toRecipeAllergenLabels([
        { id: "peanuts", viaDerived: false },
        { id: "tree_nuts", viaDerived: true },
      ]);

      expect(result).toEqual([
        { id: "peanuts", label: "Peanuts" },
        { id: "tree_nuts", label: "Tree Nuts" },
      ]);
    });
  });
});
