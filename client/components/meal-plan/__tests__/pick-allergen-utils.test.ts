import type { Allergy, FamilyProfile } from "@shared/schema";
import {
  UNCHECKED_MEAL,
  getPickWarning,
  pickNeedsCheck,
  pickedFromIngredientNames,
  pickedFromRecipe,
  pickClashPrompt,
  withAllergenNote,
} from "../pick-allergen-utils";

const ivy = {
  id: 1,
  name: "Ivy",
  allergies: [{ name: "peanuts", severity: "severe" }],
} as FamilyProfile;
const sam = { id: 2, name: "Sam", allergies: [] } as unknown as FamilyProfile;
const family = (userAllergies: Allergy[] = []) => ({
  profiles: [ivy, sam],
  userAllergies,
});
const peanuts = [{ id: "peanuts" as const, viaDerived: false }];
const forIvy = { audience: "profile" as const, familyProfileId: 1 };
const forSam = { audience: "profile" as const, familyProfileId: 2 };
const shared = { audience: "shared" as const, familyProfileId: null };
const self = { audience: "self" as const, familyProfileId: null };

describe("getPickWarning (allergen check when a meal is picked)", () => {
  it("a recipe that clashes with the chosen eater names the allergen and the eater", () => {
    expect(getPickWarning({ allergens: peanuts }, forIvy, family())).toEqual({
      kind: "clash",
      lines: ["Contains peanuts — Ivy"],
    });
  });

  it("no clash for an eater without that allergy", () => {
    expect(getPickWarning({ allergens: peanuts }, forSam, family())).toBeNull();
  });

  it("a meal for everyone checks every eater, the user included", () => {
    const out = getPickWarning(
      { allergens: peanuts },
      shared,
      family([{ name: "peanuts", severity: "mild" }]),
    );
    expect(out).toEqual({
      kind: "clash",
      lines: ["Contains peanuts — You", "Contains peanuts — Ivy"],
    });
  });

  it("a possible allergen warns too (ambiguous foods warn)", () => {
    const out = getPickWarning(
      { allergens: [{ id: "peanuts", viaDerived: true, possible: true }] },
      forIvy,
      family(),
    );
    expect(out).toEqual({
      kind: "clash",
      lines: ["May contain peanuts — Ivy"],
    });
  });

  it("a recipe whose allergens are not derived is not checked, never safe", () => {
    expect(getPickWarning({ allergens: null }, forIvy, family())).toEqual({
      kind: "unchecked",
    });
  });

  it("a meal with nothing known about it is not checked", () => {
    expect(getPickWarning(UNCHECKED_MEAL, forIvy, family())).toEqual({
      kind: "unchecked",
    });
  });

  it("nothing to check when no eater has an allergy", () => {
    expect(getPickWarning(UNCHECKED_MEAL, self, family())).toBeNull();
    expect(getPickWarning({ allergens: null }, forSam, family())).toBeNull();
  });

  it("the user's own meal is checked against the user's allergies", () => {
    expect(
      getPickWarning(
        { allergens: peanuts },
        self,
        family([{ name: "peanuts", severity: "severe" }]),
      ),
    ).toEqual({ kind: "clash", lines: ["Contains peanuts — You"] });
  });
});

describe("pickClashPrompt", () => {
  it("lists each clash and asks before adding", () => {
    const p = pickClashPrompt([
      "Contains peanuts — Ivy",
      "May contain milk — You",
    ]);
    expect(p.title).toBe("Allergy check");
    expect(p.message).toBe(
      "Contains peanuts — Ivy\nMay contain milk — You\n\nAdd it to the plan anyway?",
    );
    expect(p.confirm).toBe("Add anyway");
    expect(p.cancel).toBe("Cancel");
  });
});

describe("withAllergenNote", () => {
  it("adds the not-checked note to the success message", () => {
    expect(
      withAllergenNote("Added to Friday's dinner", "Allergens not checked"),
    ).toBe("Added to Friday's dinner. Allergens not checked.");
  });
  it("leaves the message alone with no note", () => {
    expect(withAllergenNote("Added to Friday's dinner", null)).toBe(
      "Added to Friday's dinner",
    );
  });
});

describe("what a picked meal is known to contain", () => {
  it("a saved recipe with ingredients uses its derived allergens", () => {
    expect(pickedFromRecipe({ allergens: peanuts, ingredients: [{}] })).toEqual(
      {
        allergens: peanuts,
      },
    );
  });

  it("a saved recipe with no ingredients is not checked, though stored as none found", () => {
    expect(pickedFromRecipe({ allergens: [], ingredients: [] })).toEqual(
      UNCHECKED_MEAL,
    );
    expect(
      getPickWarning(
        pickedFromRecipe({ allergens: [], ingredients: [] }),
        forIvy,
        family(),
      ),
    ).toEqual({ kind: "unchecked" });
  });

  it("a recipe not saved yet is derived from its ingredient names", () => {
    expect(
      getPickWarning(
        pickedFromIngredientNames(["peanut butter", "bread"]),
        forIvy,
        family(),
      ),
    ).toEqual({ kind: "clash", lines: ["Contains peanuts \u2014 Ivy"] });
    expect(pickedFromIngredientNames([])).toEqual(UNCHECKED_MEAL);
    expect(pickedFromIngredientNames(["  ", ""])).toEqual(UNCHECKED_MEAL);
  });

  // Security review: the server collapses whitespace before deriving, and
  // keywords match multi-word text, so pasted spacing must not hide a clash.
  it("reads a name with odd spacing the way the server does", () => {
    for (const name of ["monkey\u00a0nut", "monkey  nut", "monkey\tnut"]) {
      expect(
        getPickWarning(pickedFromIngredientNames([name]), forIvy, family()),
      ).toEqual({ kind: "clash", lines: ["Contains peanuts \u2014 Ivy"] });
    }
  });
});

describe("a family member missing from the list", () => {
  // Security review: the server may still store the meal for them.
  const gone = { audience: "profile" as const, familyProfileId: 99 };
  it("is checked, and comes out not checked, never safe", () => {
    expect(pickNeedsCheck(gone, family())).toBe(true);
    expect(getPickWarning({ allergens: peanuts }, gone, family())).toEqual({
      kind: "unchecked",
    });
  });
});

describe("pickNeedsCheck", () => {
  it("only when someone the meal is for has an allergy", () => {
    expect(pickNeedsCheck(forIvy, family())).toBe(true);
    expect(pickNeedsCheck(forSam, family())).toBe(false);
    expect(pickNeedsCheck(shared, family())).toBe(true);
    expect(pickNeedsCheck(self, family())).toBe(false);
  });
});
