import type { AllergenId, DerivedRecipeAllergen } from "./allergens";
import { parseDietConflicts, type DietConflictId } from "./diet-conflicts";

/** The diets an ingredient list can back up (spec 2026-10-17). */
export const checkableDietIds = [
  "vegetarian",
  "vegan",
  "gluten_free",
  "dairy_free",
] as const;
export type CheckableDietId = (typeof checkableDietIds)[number];
export type RecipeAttributeId = CheckableDietId | "quick";

export const QUICK_MAX_MINUTES = 30;

export const RECIPE_ATTRIBUTE_LABELS: Record<
  RecipeAttributeId,
  { word: string; spoken: string }
> = {
  vegetarian: { word: "Vegetarian", spoken: "Vegetarian" },
  vegan: { word: "Vegan", spoken: "Vegan" },
  gluten_free: { word: "Gluten-free", spoken: "Gluten-free" },
  dairy_free: { word: "Dairy-free", spoken: "Dairy-free" },
  quick: {
    word: "Quick",
    spoken: `Quick, ${QUICK_MAX_MINUTES} minutes or less`,
  },
};

const TAG_TO_DIET: Record<string, CheckableDietId> = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  glutenfree: "gluten_free",
  dairyfree: "dairy_free",
};

/** Free-text diet tags → the checkable diets they claim. Read-time only; stored tags are untouched. */
export function toCheckableDiets(
  dietTags: readonly string[] | null | undefined,
): Set<CheckableDietId> {
  const out = new Set<CheckableDietId>();
  for (const tag of dietTags ?? []) {
    const diet =
      TAG_TO_DIET[
        String(tag)
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      ];
    if (diet) out.add(diet);
  }
  return out;
}

/** What each diet must not contain, from either cache. */
const BLOCKERS: Record<
  CheckableDietId,
  { allergens: AllergenId[]; conflicts: DietConflictId[] }
> = {
  vegetarian: {
    allergens: ["fish", "shellfish"],
    conflicts: ["meat", "poultry", "animal_derived"],
  },
  vegan: {
    allergens: ["fish", "shellfish", "milk", "eggs"],
    conflicts: ["meat", "poultry", "animal_derived", "honey"],
  },
  gluten_free: { allergens: ["wheat"], conflicts: [] },
  dairy_free: { allergens: ["milk"], conflicts: [] },
};

export interface RecipeAttributeFacts {
  dietTags?: readonly string[] | null;
  allergens?: DerivedRecipeAllergen[] | null;
  /** Stored jsonb — read defensively via parseDietConflicts. */
  dietConflicts?: unknown;
  totalTimeMinutes?: number | null;
}

/**
 * The ONE rule for which attribute icons a recipe shows. A diet shows only
 * when tagged AND both ingredient caches are known AND neither cache holds a
 * blocker. Unknown is never "free of".
 */
export function getRecipeAttributes(
  facts: RecipeAttributeFacts,
): RecipeAttributeId[] {
  const out: RecipeAttributeId[] = [];
  const claimed = toCheckableDiets(facts.dietTags);
  // A vegan claim is also a vegetarian claim.
  if (claimed.has("vegan")) claimed.add("vegetarian");

  const conflicts = parseDietConflicts(facts.dietConflicts);
  const allergens = facts.allergens;
  if (claimed.size > 0 && conflicts !== null && Array.isArray(allergens)) {
    const allergenIds = new Set(allergens.map((a) => a.id));
    const conflictIds = new Set(conflicts);
    const passes = (diet: CheckableDietId) =>
      claimed.has(diet) &&
      BLOCKERS[diet].allergens.every((id) => !allergenIds.has(id)) &&
      BLOCKERS[diet].conflicts.every((id) => !conflictIds.has(id));

    for (const diet of checkableDietIds) {
      // Vegan implies vegetarian: show the stronger claim only.
      if (diet === "vegetarian" && passes("vegan")) continue;
      if (passes(diet)) out.push(diet);
    }
  }

  const minutes = facts.totalTimeMinutes;
  if (minutes != null && minutes > 0 && minutes <= QUICK_MAX_MINUTES) {
    out.push("quick");
  }
  return out;
}
