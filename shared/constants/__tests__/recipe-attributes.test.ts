import { describe, it, expect } from "vitest";
import {
  getRecipeAttributes,
  toCheckableDiets,
  RECIPE_ATTRIBUTE_LABELS,
} from "../recipe-attributes";
import { deriveRecipeAllergens } from "../allergens";
import { deriveRecipeDietConflicts } from "../diet-conflicts";

/** Facts as the write path would store them for these ingredients. */
function facts(
  dietTags: string[],
  ingredients: string[],
  totalTimeMinutes: number | null = null,
) {
  return {
    dietTags,
    allergens: deriveRecipeAllergens(ingredients),
    dietConflicts: deriveRecipeDietConflicts(ingredients),
    totalTimeMinutes,
  };
}

describe("toCheckableDiets", () => {
  it("normalises case and punctuation and ignores other tags", () => {
    expect(
      [
        ...toCheckableDiets([
          "Gluten-Free",
          "dairy free",
          "VEGAN",
          "keto",
          "italian",
        ]),
      ].sort(),
    ).toEqual(["dairy_free", "gluten_free", "vegan"]);
  });
});

describe("getRecipeAttributes", () => {
  it("shows Vegan only (not Vegetarian) when a vegan-tagged recipe passes", () => {
    expect(
      getRecipeAttributes(
        facts(["Vegan", "vegan", "vegetarian"], ["tofu", "rice"]),
      ),
    ).toEqual(["vegan"]);
  });
  it("shows Vegetarian for a vegetarian-tagged recipe with eggs", () => {
    expect(
      getRecipeAttributes(facts(["vegetarian"], ["eggs", "spinach"])),
    ).toEqual(["vegetarian"]);
  });
  it("bacon blocks vegetarian", () => {
    expect(
      getRecipeAttributes(facts(["vegetarian"], ["bacon", "eggs"])),
    ).toEqual([]);
  });
  it("gelatin blocks vegetarian", () => {
    expect(
      getRecipeAttributes(facts(["vegetarian"], ["gelatine", "sugar"])),
    ).toEqual([]);
  });
  it("fish blocks vegetarian", () => {
    expect(getRecipeAttributes(facts(["vegetarian"], ["salmon"]))).toEqual([]);
  });
  it("honey blocks vegan but not vegetarian", () => {
    expect(getRecipeAttributes(facts(["vegan"], ["oats", "honey"]))).toEqual([
      "vegetarian",
    ]);
  });
  it("eggs block vegan", () => {
    expect(getRecipeAttributes(facts(["vegan"], ["eggs"]))).toEqual([
      "vegetarian",
    ]);
  });
  it.each(["barley", "beer", "soy sauce", "rolled oats"])(
    "%s blocks gluten-free",
    (ing) => {
      expect(
        getRecipeAttributes(facts(["gluten-free"], [ing, "rice"])),
      ).toEqual([]);
    },
  );
  it("gluten-free shows when the ingredients agree", () => {
    expect(
      getRecipeAttributes(facts(["gluten-free"], ["rice", "chicken"])),
    ).toEqual(["gluten_free"]);
  });
  it("pesto blocks dairy-free", () => {
    expect(
      getRecipeAttributes(facts(["dairy-free"], ["pesto", "pasta"])),
    ).toEqual([]);
  });
  it("null dietConflicts hides every diet", () => {
    expect(
      getRecipeAttributes({
        ...facts(["vegan"], ["rice"]),
        dietConflicts: null,
      }),
    ).toEqual([]);
  });
  it("null allergens hides every diet", () => {
    expect(
      getRecipeAttributes({ ...facts(["vegan"], ["rice"]), allergens: null }),
    ).toEqual([]);
  });
  it("an empty ingredient list hides every diet", () => {
    expect(getRecipeAttributes(facts(["vegan", "gluten-free"], []))).toEqual(
      [],
    );
  });
  it("a non-array dietConflicts value is unchecked, not a crash", () => {
    expect(
      getRecipeAttributes({
        ...facts(["vegan"], ["rice"]),
        dietConflicts: "meat",
      }),
    ).toEqual([]);
  });
  it("keto gives no icon", () => {
    expect(getRecipeAttributes(facts(["keto", "low-carb"], ["beef"]))).toEqual(
      [],
    );
  });
  it("30 minutes is quick, 31 is not, null is not", () => {
    expect(getRecipeAttributes(facts([], ["rice"], 30))).toEqual(["quick"]);
    expect(getRecipeAttributes(facts([], ["rice"], 31))).toEqual([]);
    expect(getRecipeAttributes(facts([], ["rice"], null))).toEqual([]);
  });
  it("quick does not depend on ingredient checks", () => {
    expect(
      getRecipeAttributes({
        totalTimeMinutes: 15,
        allergens: null,
        dietConflicts: null,
      }),
    ).toEqual(["quick"]);
  });
  it("orders diets then quick", () => {
    expect(
      getRecipeAttributes(
        facts(["dairy-free", "vegan", "gluten-free"], ["rice"], 20),
      ),
    ).toEqual(["vegan", "gluten_free", "dairy_free", "quick"]);
  });
});

describe("RECIPE_ATTRIBUTE_LABELS", () => {
  it("has a word and a spoken label for every attribute", () => {
    for (const { word, spoken } of Object.values(RECIPE_ATTRIBUTE_LABELS)) {
      expect(word.length).toBeGreaterThan(0);
      expect(spoken.length).toBeGreaterThan(0);
    }
  });
});
