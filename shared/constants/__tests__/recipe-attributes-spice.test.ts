import { describe, it, expect } from "vitest";
import {
  getRecipeAttributes,
  parseSpiceLevel,
  RECIPE_ATTRIBUTE_LABELS,
} from "../recipe-attributes";

describe("spice level attribute", () => {
  it.each([
    ["mild", "spice_mild"],
    ["medium", "spice_medium"],
    ["hot", "spice_hot"],
  ])("shows %s as %s", (level, id) => {
    expect(getRecipeAttributes({ spiceLevel: level })).toEqual([id]);
  });

  it("shows no spice icon for null, missing or unknown values", () => {
    for (const spiceLevel of [null, undefined, "", "fiery", 3, {}]) {
      expect(getRecipeAttributes({ spiceLevel })).toEqual([]);
    }
  });

  it("has a word and spoken label for every spice id", () => {
    for (const id of ["spice_mild", "spice_medium", "spice_hot"] as const) {
      expect(RECIPE_ATTRIBUTE_LABELS[id].word.length).toBeGreaterThan(0);
      expect(RECIPE_ATTRIBUTE_LABELS[id].spoken.length).toBeGreaterThan(0);
    }
  });

  it("parseSpiceLevel accepts only the three levels", () => {
    expect(parseSpiceLevel("hot")).toBe("hot");
    expect(parseSpiceLevel("scorching")).toBeNull();
    expect(parseSpiceLevel(undefined)).toBeNull();
  });
});
