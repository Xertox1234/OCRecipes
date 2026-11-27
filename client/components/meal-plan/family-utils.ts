import type { Allergy, FamilyProfile, MealPlanItem } from "@shared/schema";
import type { AllergenId } from "@shared/constants/allergens";
import {
  ALLERGEN_INGREDIENT_MAP,
  getRecipeAllergyClashes,
} from "@shared/constants/allergens";
import type { MealAudience } from "@shared/types/family";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

export type AudienceFilter =
  | { kind: "all" }
  | { kind: "me" }
  | { kind: "profile"; profileId: number };

export interface Eater {
  name: string;
  allergies: Allergy[];
}

export interface MealClash {
  name: string;
  allergenId: AllergenId;
  level: "contains" | "possible";
  blocking: boolean;
}

/** "me" shows self and shared; a profile shows its own meals and shared. */
export function filterItemsForAudience(
  items: MealPlanItemWithRelations[],
  filter: AudienceFilter,
): MealPlanItemWithRelations[] {
  switch (filter.kind) {
    case "all":
      return items;
    case "me":
      return items.filter((i) => i.audience !== "profile");
    case "profile":
      return items.filter(
        (i) =>
          i.audience === "shared" ||
          (i.audience === "profile" && i.familyProfileId === filter.profileId),
      );
  }
}

/** A profile's own meal never counts toward the user's nutrition. */
export function countsTowardUser(
  item: Pick<MealPlanItem, "audience">,
): boolean {
  return item.audience !== "profile";
}

/** Who eats the meal: the user ("You") first, then profiles. */
export function getEaters(
  item: Pick<MealPlanItem, "audience" | "familyProfileId">,
  user: { allergies: Allergy[] },
  profiles: FamilyProfile[],
): Eater[] {
  const you: Eater = { name: "You", allergies: user.allergies };
  if (item.audience === "self") return [you];
  if (item.audience === "shared") {
    return [
      you,
      ...profiles.map((p) => ({ name: p.name, allergies: p.allergies })),
    ];
  }
  const profile = profiles.find((p) => p.id === item.familyProfileId);
  return profile ? [{ name: profile.name, allergies: profile.allergies }] : [];
}

/**
 * Clashes between the meal and each eater's allergies, on the shared recipe
 * rule. "unknown" when the allergens are not known (a scanned item, or a recipe
 * not yet derived) and an eater has an allergy.
 */
export function getMealClashes(
  item: {
    recipe: Pick<
      NonNullable<MealPlanItemWithRelations["recipe"]>,
      "allergens"
    > | null;
    scannedItem: unknown;
  },
  eaters: Eater[],
): MealClash[] | "unknown" {
  const anyAllergy = eaters.some((e) => e.allergies.length > 0);
  if (item.scannedItem) return anyAllergy ? "unknown" : [];
  if (!item.recipe) return [];

  const clashes: MealClash[] = [];
  for (const eater of eaters) {
    const result = getRecipeAllergyClashes(
      item.recipe.allergens,
      eater.allergies,
    );
    if (result === "unknown") return "unknown";
    for (const c of result) clashes.push({ name: eater.name, ...c });
  }
  return clashes;
}

/** "for everyone" | "for Ivy" | null (self, or a profile that is gone). */
export function getAudienceLabel(
  item: Pick<MealPlanItem, "audience" | "familyProfileId">,
  profiles: FamilyProfile[],
): string | null {
  if (item.audience === "shared") return "for everyone";
  if (item.audience === "profile") {
    const profile = profiles.find((p) => p.id === item.familyProfileId);
    return profile ? `for ${profile.name}` : null;
  }
  return null;
}

export function defaultAudienceFor(filter: AudienceFilter): {
  audience: MealAudience;
  familyProfileId: number | null;
} {
  if (filter.kind === "profile") {
    return { audience: "profile", familyProfileId: filter.profileId };
  }
  return { audience: "shared", familyProfileId: null };
}

/** "Contains tree nuts \u2014 Ivy" or "May contain tree nuts \u2014 Ivy". */
export function describeClash(clash: MealClash): string {
  // Same guard as the recipe allergen label: a stale id degrades to its raw
  // text instead of throwing in render.
  const label = Object.hasOwn(ALLERGEN_INGREDIENT_MAP, clash.allergenId)
    ? ALLERGEN_INGREDIENT_MAP[clash.allergenId].label.toLowerCase()
    : clash.allergenId;
  const lead = clash.level === "contains" ? "Contains" : "May contain";
  return `${lead} ${label} \u2014 ${clash.name}`;
}

export const ALLERGENS_NOT_CHECKED = "Allergens not checked";

/** What a day-view row shows about who a meal is for. */
export interface ItemFamilyInfo {
  /** "for everyone" | "for Ivy" | null. */
  audienceLabel: string | null;
  /** One line per clash; "Allergens not checked" when they are not known. */
  clashLines: string[];
}

export function getItemFamilyInfo(
  item: Pick<
    MealPlanItemWithRelations,
    "audience" | "familyProfileId" | "recipe" | "scannedItem"
  >,
  user: { allergies: Allergy[] },
  profiles: FamilyProfile[],
): ItemFamilyInfo {
  const clashes = getMealClashes(item, getEaters(item, user, profiles));
  return {
    audienceLabel: getAudienceLabel(item, profiles),
    clashLines:
      clashes === "unknown"
        ? [ALLERGENS_NOT_CHECKED]
        : clashes.map(describeClash),
  };
}

/** What a week-grid cell shows about its meals. */
export interface CellFamilyInfo {
  /** The first item's marker; nothing for the user's own meal. */
  badge: { kind: "shared" } | { kind: "profile"; initial: string } | null;
  audienceLabel: string | null;
  /** Any item in the slot has a blocking clash. Unknown allergens never warn. */
  warning: boolean;
}

/**
 * The marker describes the slot's first item; the warning covers every item
 * (decision 6). `items` is the cell's sorted list.
 */
export function getCellFamilyInfo(
  items: MealPlanItemWithRelations[],
  user: { allergies: Allergy[] },
  profiles: FamilyProfile[],
): CellFamilyInfo {
  const first = items[0];
  const audienceLabel = first ? getAudienceLabel(first, profiles) : null;
  let badge: CellFamilyInfo["badge"] = null;
  if (first && audienceLabel !== null) {
    if (first.audience === "shared") badge = { kind: "shared" };
    else {
      const name =
        profiles.find((p) => p.id === first.familyProfileId)?.name ?? "";
      const initial = Array.from(name.trim())[0]?.toUpperCase();
      if (initial) badge = { kind: "profile", initial };
    }
  }
  const warning = items.some((item) => {
    const clashes = getMealClashes(item, getEaters(item, user, profiles));
    return clashes !== "unknown" && clashes.some((c) => c.blocking);
  });
  return { badge, audienceLabel, warning };
}

/**
 * The filter in force: the chosen one while its profile still exists and
 * family planning is on, otherwise "all". A stale "Ivy" must never hide the
 * user's own meals after the profile is deleted or the switch goes off.
 */
export function resolveAudienceFilter(
  filter: AudienceFilter,
  profiles: FamilyProfile[] | null,
): AudienceFilter {
  if (profiles === null) return { kind: "all" };
  if (
    filter.kind === "profile" &&
    !profiles.some((p) => p.id === filter.profileId)
  ) {
    return { kind: "all" };
  }
  return filter;
}

/**
 * Snap points of the add menu with its "Who's it for?" row: the day screen's
 * menu, and the grid's menu that also carries "Suggest a meal".
 */
export const FAMILY_ADD_MENU_SNAP_POINTS = ["56%"];
export const FAMILY_ADD_MENU_WITH_SUGGEST_SNAP_POINTS = ["70%"];
