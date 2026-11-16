import type {
  FamilyProfile,
  MealPlanRecipe,
  ScannedItem,
} from "@shared/schema";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import {
  countsTowardUser,
  defaultAudienceFor,
  filterItemsForAudience,
  getAudienceLabel,
  getEaters,
  getMealClashes,
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
        { id: "peanuts", viaDerived: false, possible: false },
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
