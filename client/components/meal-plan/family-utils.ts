import type { Allergy, FamilyProfile, MealPlanItem } from "@shared/schema";
import type { AllergenId } from "@shared/constants/allergens";
import { getRecipeAllergyClashes } from "@shared/constants/allergens";
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
  item: Pick<MealPlanItemWithRelations, "recipe" | "scannedItem">,
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
