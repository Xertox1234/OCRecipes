import { describe, it, expect } from "vitest";
import { serializeSteps, deserializeSteps } from "../useRecipeForm";

describe("serializeSteps", () => {
  it("serializes steps to numbered string", () => {
    expect(serializeSteps(["Preheat oven", "Mix flour", "Bake"])).toBe(
      "1. Preheat oven\n2. Mix flour\n3. Bake",
    );
  });

  it("filters out empty steps", () => {
    expect(serializeSteps(["Preheat oven", "", "  ", "Bake"])).toBe(
      "1. Preheat oven\n2. Bake",
    );
  });

  it("trims step text", () => {
    expect(serializeSteps(["  Preheat oven  "])).toBe("1. Preheat oven");
  });

  it("returns empty string for no valid steps", () => {
    expect(serializeSteps(["", "  "])).toBe("");
  });

  it("handles single step", () => {
    expect(serializeSteps(["Just one step"])).toBe("1. Just one step");
  });
});

describe("deserializeSteps", () => {
  it('parses "1. Step" format', () => {
    expect(deserializeSteps("1. Preheat oven\n2. Mix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it('parses "1) Step" format', () => {
    expect(deserializeSteps("1) Preheat oven\n2) Mix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it('parses "Step 1: Step" format', () => {
    expect(deserializeSteps("Step 1: Preheat oven\nStep 2: Mix flour")).toEqual(
      ["Preheat oven", "Mix flour"],
    );
  });

  it("parses bare text (no numbering)", () => {
    expect(deserializeSteps("Preheat oven\nMix flour")).toEqual([
      "Preheat oven",
      "Mix flour",
    ]);
  });

  it("filters empty lines", () => {
    expect(deserializeSteps("1. Preheat\n\n2. Mix")).toEqual([
      "Preheat",
      "Mix",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(deserializeSteps("")).toEqual([]);
    expect(deserializeSteps("   ")).toEqual([]);
  });

  it("round-trips with serializeSteps", () => {
    const original = ["Preheat oven to 350", "Mix dry ingredients", "Bake"];
    const serialized = serializeSteps(original);
    const deserialized = deserializeSteps(serialized);
    expect(deserialized).toEqual(original);
  });
});
