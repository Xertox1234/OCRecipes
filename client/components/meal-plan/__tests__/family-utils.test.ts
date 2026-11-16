import type {
  FamilyProfile,
  MealPlanRecipe,
  ScannedItem,
} from "@shared/schema";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import {
  type MealClash,
  countsTowardUser,
  defaultAudienceFor,
  filterItemsForAudience,
  describeClash,
  getAudienceLabel,
  getCellFamilyInfo,
  getEaters,
  getItemFamilyInfo,
  getMealClashes,
  resolveAudienceFilter,
} from "../family-utils";

function makeItem(
  over: Partial<MealPlanItemWithRelations> & { id: number },
): MealPlanItemWithRelations {
  return {
    userId: "u1",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-11-16",
    mealType: "dinner",
    servings: "1",
    sortOrder: 0,
    audience: "self",
    familyProfileId: null,
    recipe: null,
    scannedItem: null,
    ...over,
  } as MealPlanItemWithRelations;
}

const ivy = {
  id: 1,
  name: "Ivy",
  allergies: [{ name: "peanuts", severity: "severe" }],
} as FamilyProfile;
const sam = { id: 2, name: "Sam", allergies: [] } as unknown as FamilyProfile;
const profiles = [ivy, sam];

const selfMeal = makeItem({ id: 1, audience: "self" });
const sharedMeal = makeItem({ id: 2, audience: "shared" });
const ivyMeal = makeItem({ id: 3, audience: "profile", familyProfileId: 1 });
const samMeal = makeItem({ id: 4, audience: "profile", familyProfileId: 2 });
const all = [selfMeal, sharedMeal, ivyMeal, samMeal];

const peanutRecipe = (allergens: MealPlanRecipe["allergens"]) =>
  ({ id: 9, allergens }) as MealPlanRecipe;

describe("filterItemsForAudience", () => {
  it("all keeps every meal", () => {
    expect(filterItemsForAudience(all, { kind: "all" })).toEqual(all);
  });
  it("me keeps self and shared", () => {
    expect(filterItemsForAudience(all, { kind: "me" })).toEqual([
      selfMeal,
      sharedMeal,
    ]);
  });
  it("a profile keeps that profile's meals and shared", () => {
    expect(
      filterItemsForAudience(all, { kind: "profile", profileId: 1 }),
    ).toEqual([sharedMeal, ivyMeal]);
  });
});

describe("countsTowardUser", () => {
  it("is false only for a profile meal", () => {
    expect(countsTowardUser({ audience: "self" })).toBe(true);
    expect(countsTowardUser({ audience: "shared" })).toBe(true);
    expect(countsTowardUser({ audience: "profile" })).toBe(false);
  });
});

describe("getEaters", () => {
  const user = { allergies: [{ name: "milk", severity: "mild" as const }] };
  it("self is the user alone", () => {
    expect(getEaters(selfMeal, user, profiles)).toEqual([
      { name: "You", allergies: user.allergies },
    ]);
  });
  it("shared is the user first, then every profile", () => {
    expect(getEaters(sharedMeal, user, profiles).map((e) => e.name)).toEqual([
      "You",
      "Ivy",
      "Sam",
    ]);
  });
  it("a profile meal is that profile alone", () => {
    expect(getEaters(ivyMeal, user, profiles)).toEqual([
      { name: "Ivy", allergies: ivy.allergies },
    ]);
  });
  it("a profile meal whose profile is missing has no eaters", () => {
    expect(
      getEaters(
        makeItem({ id: 5, audience: "profile", familyProfileId: 99 }),
        user,
        profiles,
      ),
    ).toEqual([]);
  });
});

describe("getMealClashes", () => {
  const eaters = [
    { name: "You", allergies: [] },
    { name: "Ivy", allergies: ivy.allergies },
  ];
  it("builds on the shared clash rule and names the eater", () => {
    const item = makeItem({
      id: 6,
      recipe: peanutRecipe([
        { id: "peanuts", viaDerived: false },
      ] as MealPlanRecipe["allergens"]),
    });
    expect(getMealClashes(item, eaters)).toEqual([
      { name: "Ivy", allergenId: "peanuts", level: "contains", blocking: true },
    ]);
  });
  it("is empty for a recipe with no clash", () => {
    const item = makeItem({ id: 7, recipe: peanutRecipe([]) });
    expect(getMealClashes(item, eaters)).toEqual([]);
  });
  it("is unknown for a recipe with no derived allergens when an eater has an allergy", () => {
    expect(
      getMealClashes(makeItem({ id: 8, recipe: peanutRecipe(null) }), eaters),
    ).toBe("unknown");
  });
  it("is empty for an underived recipe when nobody has an allergy", () => {
    expect(
      getMealClashes(makeItem({ id: 8, recipe: peanutRecipe(null) }), [
        { name: "You", allergies: [] },
      ]),
    ).toEqual([]);
  });
  it("is unknown for a scanned item when an eater has an allergy", () => {
    const item = makeItem({ id: 10, scannedItem: { id: 1 } as ScannedItem });
    expect(getMealClashes(item, eaters)).toBe("unknown");
    expect(getMealClashes(item, [{ name: "You", allergies: [] }])).toEqual([]);
  });
});

describe("getAudienceLabel", () => {
  it("labels shared, a profile, and nothing for self", () => {
    expect(getAudienceLabel(selfMeal, profiles)).toBeNull();
    expect(getAudienceLabel(sharedMeal, profiles)).toBe("for everyone");
    expect(getAudienceLabel(ivyMeal, profiles)).toBe("for Ivy");
  });
  it("is null for a profile meal whose profile is missing", () => {
    expect(
      getAudienceLabel(
        makeItem({ id: 5, audience: "profile", familyProfileId: 99 }),
        profiles,
      ),
    ).toBeNull();
  });
});

describe("defaultAudienceFor", () => {
  it("defaults to the filtered profile, otherwise shared", () => {
    expect(defaultAudienceFor({ kind: "profile", profileId: 2 })).toEqual({
      audience: "profile",
      familyProfileId: 2,
    });
    expect(defaultAudienceFor({ kind: "all" })).toEqual({
      audience: "shared",
      familyProfileId: null,
    });
    expect(defaultAudienceFor({ kind: "me" })).toEqual({
      audience: "shared",
      familyProfileId: null,
    });
  });
});

describe("describeClash", () => {
  it("words a contains clash from its level", () => {
    expect(
      describeClash({
        name: "Ivy",
        allergenId: "tree_nuts",
        level: "contains",
        blocking: true,
      }),
    ).toBe("Contains tree nuts \u2014 Ivy");
  });
  it("words a possible clash as may contain", () => {
    expect(
      describeClash({
        name: "Ivy",
        allergenId: "tree_nuts",
        level: "possible",
        blocking: false,
      }),
    ).toBe("May contain tree nuts \u2014 Ivy");
  });
  it("falls back to the raw id for an allergen it has no label for", () => {
    expect(
      describeClash({
        name: "Ivy",
        allergenId: "unheard_of" as unknown as MealClash["allergenId"],
        level: "contains",
        blocking: true,
      }),
    ).toBe("Contains unheard_of \u2014 Ivy");
  });
});

describe("getItemFamilyInfo", () => {
  const user = { allergies: [] };
  const nutRecipe = (possible: boolean) =>
    peanutRecipe([
      { id: "peanuts", viaDerived: false, possible },
    ] as MealPlanRecipe["allergens"]);

  it("labels the audience and lists one line per clash", () => {
    const meal = makeItem({
      id: 20,
      audience: "profile",
      familyProfileId: 1,
      recipe: nutRecipe(false),
    });
    expect(getItemFamilyInfo(meal, user, profiles)).toEqual({
      audienceLabel: "for Ivy",
      clashLines: ["Contains peanuts \u2014 Ivy"],
    });
  });
  it("words a possible clash as may contain", () => {
    const meal = makeItem({
      id: 21,
      audience: "profile",
      familyProfileId: 1,
      recipe: nutRecipe(true),
    });
    expect(getItemFamilyInfo(meal, user, profiles).clashLines).toEqual([
      "May contain peanuts \u2014 Ivy",
    ]);
  });
  it("says allergens are not checked when they are unknown", () => {
    const meal = makeItem({
      id: 22,
      audience: "profile",
      familyProfileId: 1,
      recipe: peanutRecipe(null),
    });
    expect(getItemFamilyInfo(meal, user, profiles).clashLines).toEqual([
      "Allergens not checked",
    ]);
  });
  it("has no label and no lines for the user's own clean meal", () => {
    expect(getItemFamilyInfo(selfMeal, user, profiles)).toEqual({
      audienceLabel: null,
      clashLines: [],
    });
  });
});

describe("getCellFamilyInfo", () => {
  const user = { allergies: [] };
  const peanuts = peanutRecipe([
    { id: "peanuts", viaDerived: false },
  ] as MealPlanRecipe["allergens"]);

  it("is a shared badge, label and no warning for a shared meal", () => {
    expect(getCellFamilyInfo([sharedMeal], user, profiles)).toEqual({
      badge: { kind: "shared" },
      audienceLabel: "for everyone",
      warning: false,
    });
  });
  it("is the profile's initial for a profile meal", () => {
    expect(getCellFamilyInfo([ivyMeal], user, profiles)).toEqual({
      badge: { kind: "profile", initial: "I" },
      audienceLabel: "for Ivy",
      warning: false,
    });
  });
  it("has no badge for the user's own meal", () => {
    expect(getCellFamilyInfo([selfMeal], user, profiles)).toEqual({
      badge: null,
      audienceLabel: null,
      warning: false,
    });
  });
  it("describes the first item but warns for a clash in any item", () => {
    const clashing = makeItem({
      id: 30,
      audience: "profile",
      familyProfileId: 1,
      recipe: peanuts,
    });
    expect(getCellFamilyInfo([selfMeal, clashing], user, profiles)).toEqual({
      badge: null,
      audienceLabel: null,
      warning: true,
    });
  });
  it("does not warn for a non-blocking possible clash", () => {
    const mia = {
      id: 3,
      name: "Mia",
      allergies: [{ name: "peanuts", severity: "mild" }],
    } as FamilyProfile;
    const maybe = makeItem({
      id: 31,
      audience: "profile",
      familyProfileId: 3,
      recipe: peanutRecipe([
        { id: "peanuts", viaDerived: true, possible: true },
      ] as MealPlanRecipe["allergens"]),
    });
    expect(getMealClashes(maybe, getEaters(maybe, user, [mia]))).toEqual([
      {
        name: "Mia",
        allergenId: "peanuts",
        level: "possible",
        blocking: false,
      },
    ]);
    expect(getCellFamilyInfo([maybe], user, [mia]).warning).toBe(false);
  });
  it("does not warn when the allergens are unknown", () => {
    const unknown = makeItem({
      id: 32,
      audience: "profile",
      familyProfileId: 1,
      recipe: peanutRecipe(null),
    });
    expect(getCellFamilyInfo([unknown], user, profiles).warning).toBe(false);
  });
});

describe("resolveAudienceFilter", () => {
  it("keeps a filter whose profile still exists", () => {
    const f = { kind: "profile", profileId: 1 } as const;
    expect(resolveAudienceFilter(f, profiles)).toBe(f);
    expect(resolveAudienceFilter({ kind: "me" }, profiles)).toEqual({
      kind: "me",
    });
  });
  it("falls back to all when the profile is gone", () => {
    expect(
      resolveAudienceFilter({ kind: "profile", profileId: 99 }, profiles),
    ).toEqual({ kind: "all" });
  });
  it("is all when family planning is not active", () => {
    expect(resolveAudienceFilter({ kind: "me" }, null)).toEqual({
      kind: "all",
    });
    expect(
      resolveAudienceFilter({ kind: "profile", profileId: 1 }, null),
    ).toEqual({ kind: "all" });
  });
});
