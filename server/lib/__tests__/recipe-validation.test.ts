import { describe, it, expect } from "vitest";
import { validateRecipeQuality } from "../recipe-validation";

describe("validateRecipeQuality", () => {
  it("accepts a recipe with title, instructions, and ingredients", () => {
    const result = validateRecipeQuality({
      title: "Chicken Parmesan",
      instructions: ["Preheat oven to 375F", "Season chicken"],
      ingredients: [{ name: "chicken breast" }],
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a recipe with title and at least 1 instruction (no ingredients)", () => {
    const result = validateRecipeQuality({
      title: "Simple Toast",
      instructions: ["Toast the bread"],
      ingredients: [],
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a recipe with title and at least 1 ingredient (no instructions)", () => {
    const result = validateRecipeQuality({
      title: "Simple Salad",
      instructions: [],
      ingredients: [{ name: "lettuce" }],
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = validateRecipeQuality({
      title: "ab",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/title/i);
  });

  it("rejects an empty title", () => {
    const result = validateRecipeQuality({
      title: "",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a whitespace-only title", () => {
    const result = validateRecipeQuality({
      title: "   ",
      instructions: ["Do something"],
      ingredients: [{ name: "flour" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects when both instructions and ingredients are empty", () => {
    const result = validateRecipeQuality({
      title: "Empty Recipe",
      instructions: [],
      ingredients: [],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ingredient|instruction/i);
  });

  it("rejects when both instructions and ingredients are null", () => {
    const result = validateRecipeQuality({
      title: "Null Recipe",
      instructions: null,
      ingredients: null,
    });
    expect(result.valid).toBe(false);
  });

  it("filters out whitespace-only instructions before checking", () => {
    const result = validateRecipeQuality({
      title: "Bad Instructions",
      instructions: ["   ", "", "  "],
      ingredients: [],
    });
    expect(result.valid).toBe(false);
  });

  it("filters out empty-name ingredients before checking", () => {
    const result = validateRecipeQuality({
      title: "Bad Ingredients",
      instructions: [],
      ingredients: [{ name: "" }, { name: "   " }],
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a quick entry with a title alone", () => {
    const result = validateRecipeQuality({
      title: "Bacon and eggs",
      sourceType: "quick_entry",
    });
    expect(result.valid).toBe(true);
  });

  it("still requires a real title for a quick entry", () => {
    const result = validateRecipeQuality({
      title: "ab",
      sourceType: "quick_entry",
    });
    expect(result.valid).toBe(false);
  });
});
