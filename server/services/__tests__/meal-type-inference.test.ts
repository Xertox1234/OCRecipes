import { describe, it, expect, vi } from "vitest";

import { inferMealTypes } from "../meal-type-inference";

vi.mock("../../storage", () => ({ storage: {} }));

describe("inferMealTypes", () => {
  it("tags breakfast keywords", () => {
    expect(inferMealTypes("Blueberry Pancakes")).toContain("breakfast");
  });

  it("tags lunch keywords", () => {
    expect(inferMealTypes("Turkey Sandwich")).toContain("lunch");
  });

  it("tags dinner keywords", () => {
    expect(inferMealTypes("Chicken Tikka Masala")).toContain("dinner");
  });

  it("tags snack keywords", () => {
    expect(inferMealTypes("Chocolate Protein Shake")).toContain("snack");
  });

  it("returns multiple types for overlapping keywords (muffin → breakfast + snack)", () => {
    const types = inferMealTypes("Banana Muffin");
    expect(types).toContain("breakfast");
    expect(types).toContain("snack");
  });

  it("returns multiple types for shared keywords (wrap → lunch + dinner)", () => {
    const types = inferMealTypes("Chicken Wrap");
    expect(types).toContain("lunch");
    expect(types).toContain("dinner");
  });

  it("returns ['unclassified'] when no keywords match", () => {
    const types = inferMealTypes("Mystery Dish");
    expect(types).toEqual(["unclassified"]);
  });

  it("is case insensitive", () => {
    expect(inferMealTypes("OATMEAL WITH BERRIES")).toContain("breakfast");
  });

  it("uses ingredient names for signal", () => {
    const types = inferMealTypes("Morning Power Bowl", [
      "oatmeal",
      "banana",
      "honey",
    ]);
    expect(types).toContain("breakfast");
  });

  it("handles empty title gracefully", () => {
    const types = inferMealTypes("");
    expect(types).toEqual(["unclassified"]);
  });

  it("handles undefined ingredients", () => {
    const types = inferMealTypes("Steak");
    expect(types).toContain("dinner");
  });

  it("resists substring false positives", () => {
    // "chip" should not match in "chipotle"
    expect(inferMealTypes("Chipotle Chicken Bowl")).not.toContain("snack");
    // "sub" should not match in "substantial" — salmon triggers dinner only
    expect(inferMealTypes("Substantial Salmon")).not.toContain("lunch");
    // "nuts" should not match in "nutmeg" — pasta triggers dinner only
    expect(inferMealTypes("Nutmeg Spiced Pasta")).not.toContain("snack");
    // "eggs" should not match in "eggplant" — pasta triggers dinner only
    expect(inferMealTypes("Eggplant Parmesan Pasta")).not.toContain(
      "breakfast",
    );
  });
});
