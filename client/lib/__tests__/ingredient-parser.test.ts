import { describe, it, expect } from "vitest";
import { parseIngredientText } from "../ingredient-parser";

describe("parseIngredientText", () => {
  it("parses quantity + unit + name", () => {
    expect(parseIngredientText("2 cups flour")).toEqual({
      name: "flour",
      quantity: "2",
      unit: "cups",
    });
  });

  it("parses simple fraction", () => {
    expect(parseIngredientText("1/2 tsp salt")).toEqual({
      name: "salt",
      quantity: "0.5",
      unit: "tsp",
    });
  });

  it("parses compound fraction", () => {
    expect(parseIngredientText("1 1/2 cups milk")).toEqual({
      name: "milk",
      quantity: "1.5",
      unit: "cups",
    });
  });

  it("parses decimal quantity", () => {
    expect(parseIngredientText("1.5 lbs chicken")).toEqual({
      name: "chicken",
      quantity: "1.5",
      unit: "lbs",
    });
  });

  it("parses name only (no quantity or unit)", () => {
    expect(parseIngredientText("flour")).toEqual({
      name: "flour",
      quantity: null,
      unit: null,
    });
  });

  it("parses quantity + name (no unit)", () => {
    expect(parseIngredientText("3 eggs")).toEqual({
      name: "eggs",
      quantity: "3",
      unit: null,
    });
  });

  it("parses plural units", () => {
    expect(parseIngredientText("3 cloves garlic")).toEqual({
      name: "garlic",
      quantity: "3",
      unit: "cloves",
    });
  });

  it("handles units case-insensitively", () => {
    expect(parseIngredientText("2 Cups flour")).toEqual({
      name: "flour",
      quantity: "2",
      unit: "cups",
    });
  });

  it("handles tbsp", () => {
    expect(parseIngredientText("1 tbsp olive oil")).toEqual({
      name: "olive oil",
      quantity: "1",
      unit: "tbsp",
    });
  });

  it("handles oz", () => {
    expect(parseIngredientText("8 oz cream cheese")).toEqual({
      name: "cream cheese",
      quantity: "8",
      unit: "oz",
    });
  });

  it("handles ml", () => {
    expect(parseIngredientText("250 ml water")).toEqual({
      name: "water",
      quantity: "250",
      unit: "ml",
    });
  });

  it("handles slices", () => {
    expect(parseIngredientText("2 slices bread")).toEqual({
      name: "bread",
      quantity: "2",
      unit: "slices",
    });
  });

  it("handles pinch", () => {
    expect(parseIngredientText("1 pinch cayenne")).toEqual({
      name: "cayenne",
      quantity: "1",
      unit: "pinch",
    });
  });

  it("handles multi-word ingredient names", () => {
    expect(parseIngredientText("2 cups all-purpose flour")).toEqual({
      name: "all-purpose flour",
      quantity: "2",
      unit: "cups",
    });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseIngredientText("  2 cups flour  ")).toEqual({
      name: "flour",
      quantity: "2",
      unit: "cups",
    });
  });

  it("handles 1/4 fraction", () => {
    expect(parseIngredientText("1/4 cup sugar")).toEqual({
      name: "sugar",
      quantity: "0.25",
      unit: "cup",
    });
  });

  it("handles 3/4 fraction", () => {
    expect(parseIngredientText("3/4 tsp cinnamon")).toEqual({
      name: "cinnamon",
      quantity: "0.75",
      unit: "tsp",
    });
  });

  it("returns empty name as full raw text", () => {
    // When name portion is empty after parsing, fall back to raw text
    expect(parseIngredientText("2 cups")).toEqual({
      name: "2 cups",
      quantity: "2",
      unit: "cups",
    });
  });
});
