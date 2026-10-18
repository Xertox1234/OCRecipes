import type { AllergenId, DerivedRecipeAllergen } from "./allergens";
import { parseDietConflicts, type DietConflictId } from "./diet-conflicts";
import { spiceLevelSchema, type SpiceLevel } from "../schemas/recipe-finder";

/**
 * Read a stored/AI-supplied spice level defensively: only mild / medium / hot
 * pass; anything else is `null` ("not worked out", no icon). Never guesses.
 */
export function parseSpiceLevel(value: unknown): SpiceLevel | null {
  const parsed = spiceLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The diets an ingredient list can back up (spec 2026-10-17). */
export const checkableDietIds = [
  "vegetarian",
  "vegan",
  "gluten_free",
  "dairy_free",
] as const;
export type CheckableDietId = (typeof checkableDietIds)[number];
export const spiceAttributeIds = [
  "spice_mild",
  "spice_medium",
  "spice_hot",
] as const;
export type SpiceAttributeId = (typeof spiceAttributeIds)[number];
export type RecipeAttributeId = CheckableDietId | SpiceAttributeId | "quick";

const SPICE_TO_ATTRIBUTE: Record<SpiceLevel, SpiceAttributeId> = {
  mild: "spice_mild",
  medium: "spice_medium",
  hot: "spice_hot",
};

export const QUICK_MAX_MINUTES = 30;

export const RECIPE_ATTRIBUTE_LABELS: Record<
  RecipeAttributeId,
  { word: string; spoken: string }
> = {
  vegetarian: { word: "Vegetarian", spoken: "Vegetarian" },
  vegan: { word: "Vegan", spoken: "Vegan" },
  gluten_free: { word: "Gluten-free", spoken: "Gluten-free" },
  dairy_free: { word: "Dairy-free", spoken: "Dairy-free" },
  // "Medium" alone would read like a difficulty, so every spice word says "spice".
  spice_mild: { word: "Mild spice", spoken: "Mild spice level" },
  spice_medium: { word: "Medium spice", spoken: "Medium spice level" },
  spice_hot: { word: "Hot spice", spoken: "Hot spice level" },
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
  /** AI-set at write time; read defensively via parseSpiceLevel. */
  spiceLevel?: unknown;
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

  const spice = parseSpiceLevel(facts.spiceLevel);
  if (spice) out.push(SPICE_TO_ATTRIBUTE[spice]);

  const minutes = facts.totalTimeMinutes;
  if (minutes != null && minutes > 0 && minutes <= QUICK_MAX_MINUTES) {
    out.push("quick");
  }
  return out;
}
