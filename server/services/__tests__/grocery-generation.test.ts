import { describe, it, expect } from "vitest";
import {
  normalizeIngredientName,
  categorizeIngredient,
  generateGroceryItems,
} from "../grocery-generation";
import type { RecipeIngredient } from "@shared/schema";

function makeIngredient(
  overrides: Partial<RecipeIngredient> & { name: string },
): RecipeIngredient {
  return {
    id: 1,
    recipeId: 1,
    name: overrides.name,
    quantity: overrides.quantity ?? null,
    unit: overrides.unit ?? null,
    category: overrides.category ?? "other",
    displayOrder: overrides.displayOrder ?? 0,
  };
}

describe("grocery-generation", () => {
  describe("normalizeIngredientName", () => {
    it("should lowercase and trim", () => {
      expect(normalizeIngredientName("  Chicken Breast  ")).toBe(
        "chicken breast",
      );
    });

    it("should collapse whitespace", () => {
      expect(normalizeIngredientName("bell   pepper")).toBe("bell pepper");
    });

    it("should handle empty string", () => {
      expect(normalizeIngredientName("")).toBe("");
    });
  });

  describe("categorizeIngredient", () => {
    it("should categorize chicken as meat", () => {
      expect(categorizeIngredient("chicken breast")).toBe("meat");
    });

    it("should categorize salmon as seafood", () => {
      expect(categorizeIngredient("salmon fillet")).toBe("seafood");
    });

    it("should categorize tomato as produce", () => {
      expect(categorizeIngredient("tomato")).toBe("produce");
    });

    it("should categorize milk as dairy", () => {
      expect(categorizeIngredient("whole milk")).toBe("dairy");
    });

    it("should categorize rice as grains", () => {
      expect(categorizeIngredient("brown rice")).toBe("grains");
    });

    it("should default to other for unknown items", () => {
      expect(categorizeIngredient("xylitol powder")).toBe("other");
    });

    it("should categorize cumin as spices", () => {
      expect(categorizeIngredient("ground cumin")).toBe("spices");
    });
  });

  describe("generateGroceryItems", () => {
    it("should aggregate duplicate ingredients by name and unit", () => {
      const ingredients = [
        makeIngredient({ name: "Chicken Breast", quantity: "200", unit: "g" }),
        makeIngredient({ name: "chicken breast", quantity: "300", unit: "g" }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("chicken breast");
      expect(result[0].quantity).toBe(500);
      expect(result[0].unit).toBe("g");
    });

    it("should keep items with different units separate", () => {
      const ingredients = [
        makeIngredient({ name: "flour", quantity: "2", unit: "cups" }),
        makeIngredient({ name: "flour", quantity: "100", unit: "g" }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result).toHaveLength(2);
    });

    it("should handle ingredients with null quantities", () => {
      const ingredients = [
        makeIngredient({ name: "salt", quantity: null, unit: null }),
        makeIngredient({ name: "Salt", quantity: null, unit: null }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBeNull();
    });

    it("should sum when one quantity is null and other is not", () => {
      const ingredients = [
        makeIngredient({ name: "olive oil", quantity: null, unit: "tbsp" }),
        makeIngredient({ name: "olive oil", quantity: "2", unit: "tbsp" }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(2);
    });

    it("should auto-categorize ingredients", () => {
      const ingredients = [
        makeIngredient({
          name: "chicken thigh",
          quantity: "500",
          unit: "g",
          category: "other",
        }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result[0].category).toBe("meat");
    });

    it("should preserve explicit category from ingredient", () => {
      const ingredients = [
        makeIngredient({
          name: "special blend",
          quantity: "1",
          unit: "packet",
          category: "spices",
        }),
      ];

      const result = generateGroceryItems(ingredients);
      expect(result[0].category).toBe("spices");
    });

    it("should return empty array for empty input", () => {
      expect(generateGroceryItems([])).toEqual([]);
    });

    it("should sort by category then name", () => {
      const ingredients = [
        makeIngredient({ name: "Zucchini", quantity: "1", unit: null }),
        makeIngredient({ name: "Apple", quantity: "2", unit: null }),
        makeIngredient({ name: "Chicken", quantity: "500", unit: "g" }),
      ];

      const result = generateGroceryItems(ingredients);
      // meat before produce alphabetically
      expect(result[0].category).toBe("meat");
      expect(result[1].name).toBe("apple");
      expect(result[2].name).toBe("zucchini");
    });
  });
});
