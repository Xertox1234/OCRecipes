import { describe, it, expect } from "vitest";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import { capImportedRecipe } from "../recipe-import-caps";

function recipe(overrides: Partial<ImportedRecipeData>): ImportedRecipeData {
  return {
    title: "Pie",
    description: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    cuisine: null,
    dietTags: [],
    ingredients: [],
    instructions: null,
    imageUrl: null,
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    sourceUrl: "https://x.test/pie",
    ...overrides,
  };
}

const steps = (instructions: string[]) =>
  capImportedRecipe(recipe({ instructions })).instructions ?? [];

// Security audit 2026-11-12, L9 (review): many pages give the whole method as
// one block. Cutting it at the step cap dropped the end of the recipe without
// a word, so an over-long step is broken into several steps instead.
describe("capImportedRecipe — an over-long step", () => {
  it("is broken after a sentence, losing no text", () => {
    const method = Array.from(
      { length: 300 },
      (_, i) => `Do part ${i} of the method.`,
    ).join(" ");
    expect(method.length).toBeGreaterThan(2000 * 3);

    const out = steps([method]);

    expect(out.length).toBeGreaterThan(3);
    expect(Math.max(...out.map((s) => s.length))).toBeLessThanOrEqual(2000);
    expect(out.every((s) => s.endsWith("."))).toBe(true);
    expect(out.join(" ")).toBe(method);
  });

  it("is broken at a space when no sentence ends in reach", () => {
    const method = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(" ");
    expect(method.length).toBeGreaterThan(2000 * 3);

    const out = steps([method]);

    expect(Math.max(...out.map((s) => s.length))).toBeLessThanOrEqual(2000);
    expect(out.join(" ")).toBe(method);
  });

  it("is broken mid-text only when it has no space at all", () => {
    expect(steps(["z".repeat(5000)]).map((s) => s.length)).toEqual([
      2000, 2000, 1000,
    ]);
  });

  it("never ends a piece on half an emoji", () => {
    const method = "a" + "😀".repeat(1500);
    expect(method.length).toBe(3001);

    const out = steps([method]);

    const endsOnHighSurrogate = (s: string) => {
      const last = s.charCodeAt(s.length - 1);
      return last >= 0xd800 && last <= 0xdbff;
    };
    expect(out.some(endsOnHighSurrogate)).toBe(false);
    expect(out.join("")).toBe(method);
  });

  it("still keeps at most 100 steps after breaking", () => {
    const long = Array.from({ length: 60 }, () => "z".repeat(5000));
    const out = steps(long);
    expect(out).toHaveLength(100);
    expect(Math.max(...out.map((s) => s.length))).toBe(2000);
  });

  it("leaves steps within the cap as the page wrote them", () => {
    expect(steps(["Mix.", "Bake.", "x".repeat(2000)])).toEqual([
      "Mix.",
      "Bake.",
      "x".repeat(2000),
    ]);
  });
});
