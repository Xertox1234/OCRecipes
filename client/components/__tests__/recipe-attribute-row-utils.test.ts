import { describe, it, expect } from "vitest";
import {
  toRecipeAttributeSpokenList,
  toRecipeAttributeA11ySuffix,
} from "../recipe-attribute-row-utils";
import { toRecipeAllergenA11ySuffix } from "../recipe-allergen-label-utils";
import type { RecipeAttributeFacts } from "@shared/constants/recipe-attributes";

const veganQuick: RecipeAttributeFacts = {
  dietTags: ["vegan"],
  allergens: [],
  dietConflicts: [],
  totalTimeMinutes: 20,
};

describe("toRecipeAttributeSpokenList", () => {
  it("lists the shown attributes in words", () => {
    expect(toRecipeAttributeSpokenList(veganQuick)).toBe(
      "Vegan, Quick, 30 minutes or less",
    );
  });
});

describe("toRecipeAttributeA11ySuffix", () => {
  it("adds the attributes, then the unchanged Contains suffix", () => {
    expect(
      toRecipeAttributeA11ySuffix({
        ...veganQuick,
        allergens: [{ id: "soy", viaDerived: false }],
      }),
    ).toBe(". Vegan, Quick, 30 minutes or less. Contains: Soy");
  });

  it("is empty with no attributes and no allergens", () => {
    expect(
      toRecipeAttributeA11ySuffix({
        dietTags: [],
        allergens: [],
        dietConflicts: [],
        totalTimeMinutes: null,
      }),
    ).toBe("");
  });

  it("with allergens only, is byte-identical to the allergen suffix", () => {
    const allergens = [
      { id: "peanuts" as const, viaDerived: false },
      { id: "milk" as const, viaDerived: true },
    ];
    expect(
      toRecipeAttributeA11ySuffix({
        dietTags: [],
        allergens,
        dietConflicts: null,
        totalTimeMinutes: null,
      }),
    ).toBe(toRecipeAllergenA11ySuffix(allergens));
  });
});
