import { describe, it, expect } from "vitest";
import { mapOffAllergenTags } from "../off-allergen-tags";

describe("mapOffAllergenTags", () => {
  it("maps non-obvious OFF tags to our IDs", () => {
    expect(mapOffAllergenTags(["en:gluten"])).toEqual(["wheat"]);
    expect(mapOffAllergenTags(["en:crustaceans"])).toEqual(["shellfish"]);
    expect(mapOffAllergenTags(["en:molluscs"])).toEqual(["shellfish"]);
    expect(mapOffAllergenTags(["en:nuts"])).toEqual(["tree_nuts"]);
    expect(mapOffAllergenTags(["en:peanuts"])).toEqual(["peanuts"]);
    expect(mapOffAllergenTags(["en:soybeans"])).toEqual(["soy"]);
    expect(mapOffAllergenTags(["en:sesame-seeds"])).toEqual(["sesame"]);
  });

  it("is case-insensitive and de-duplicates (crustaceans + molluscs → one shellfish)", () => {
    expect(mapOffAllergenTags(["EN:Crustaceans", "en:molluscs"])).toEqual([
      "shellfish",
    ]);
  });

  it("drops tags outside our 9-allergen model rather than guessing", () => {
    expect(mapOffAllergenTags(["en:mustard", "en:celery", "en:lupin"])).toEqual(
      [],
    );
    expect(mapOffAllergenTags(["en:milk", "en:mustard"])).toEqual(["milk"]);
  });

  it("handles empty / non-array input safely", () => {
    expect(mapOffAllergenTags([])).toEqual([]);
  });
});
