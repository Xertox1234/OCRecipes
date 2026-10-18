import { ingredientContainsKeyword } from "./allergens";

/**
 * Diet conflicts: ingredient facts the allergen cache does not cover but the
 * vegetarian/vegan icons need (spec 2026-10-17). Fish, shellfish, milk, eggs
 * and wheat come from the allergen cache and are NOT repeated here.
 */
export const dietConflictIds = [
  "meat",
  "poultry",
  "animal_derived",
  "honey",
] as const;
export type DietConflictId = (typeof dietConflictIds)[number];

const CONFLICT_KEYWORDS: Record<DietConflictId, readonly string[]> = {
  // Whole-word match on both ends (getKeywordPattern), so "ham" never matches
  // "graham". Bare "mince" is left out — ambiguous ("mince pies"); "beef
  // mince" flags through "beef".
  meat: [
    "beef",
    "pork",
    "bacon",
    "ham",
    "lamb",
    "veal",
    "venison",
    "steak",
    "steaks",
    "sausage",
    "sausages",
    "salami",
    "pepperoni",
    "chorizo",
    "prosciutto",
    "pancetta",
    "meatball",
    "meatballs",
  ],
  poultry: ["chicken", "turkey", "duck", "goose", "quail"],
  animal_derived: [
    "gelatin",
    "gelatine",
    "lard",
    "suet",
    "tallow",
    "bone broth",
    "rennet",
  ],
  honey: ["honey"],
};

/**
 * A plant word directly before the keyword (space or hyphen join only — the
 * same narrow join as the allergen plant-substitute guard, because suppression
 * is the dangerous direction) names a substitute: "veggie bacon".
 */
const PLANT_QUALIFIERS = [
  "vegan",
  "vegetarian",
  "veggie",
  "plant-based",
  "meatless",
  "meat-free",
  "tofu",
  "soy",
  "seitan",
  "mushroom",
  "jackfruit",
  "vegetable",
  "microbial",
];

/** Poultry followed by egg(s) is an egg, which the egg allergen covers. */
const EGG_SUFFIX = /^[\s-]+eggs?(?:$|[\s,;/()-])/;

const qualifierPatternCache = new Map<string, RegExp>();

function qualifiedPattern(keyword: string): RegExp {
  let pattern = qualifierPatternCache.get(keyword);
  if (!pattern) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(
      `(?:^|[\\s,;/()\\-])(?:${PLANT_QUALIFIERS.join("|")})[\\s\\-]${escaped}(?:$|[\\s,;/()\\-])`,
      "i",
    );
    qualifierPatternCache.set(keyword, pattern);
  }
  return pattern;
}

function conflictKeywordHits(
  lower: string,
  keyword: string,
  id: DietConflictId,
): boolean {
  if (!ingredientContainsKeyword(lower, keyword)) return false;
  if (qualifiedPattern(keyword).test(lower)) return false;
  if (id === "poultry") {
    const at = lower.indexOf(keyword);
    if (at !== -1 && EGG_SUFFIX.test(lower.slice(at + keyword.length))) {
      return false;
    }
  }
  return true;
}

/**
 * Derives the `diet_conflicts` cache. `null` for an empty list: zero
 * ingredients is "unchecked", never "nothing found" — unlike
 * `deriveRecipeAllergens([])`, which returns `[]`.
 */
export function deriveRecipeDietConflicts(
  ingredientNames: string[],
): DietConflictId[] | null {
  if (ingredientNames.length === 0) return null;
  const lower = ingredientNames.map((n) => n.toLowerCase());
  return dietConflictIds.filter((id) =>
    lower.some((ing) =>
      CONFLICT_KEYWORDS[id].some((kw) => conflictKeywordHits(ing, kw, id)),
    ),
  );
}

/** Reads stored jsonb defensively: non-array → unchecked; unknown ids dropped. */
export function parseDietConflicts(value: unknown): DietConflictId[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is DietConflictId =>
    (dietConflictIds as readonly unknown[]).includes(v),
  );
}
