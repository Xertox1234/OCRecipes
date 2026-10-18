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
    // Bare "meat" covers "ground meat" / "meat sauce". Bare "goat" stays out
    // ("goat cheese"). "meat-free" is skipped per occurrence (MEAT_FREE_SUFFIX).
    "meat",
    "mutton",
    "rabbit",
    "lardons",
    "pastrami",
    "guanciale",
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
 *
 * Only words that unambiguously name a substitute belong here. Mushroom, soy,
 * tofu and vegetable are NOT listed: they also come before real meat
 * ("vegetable beef soup", "mushroom beef", "soy chicken").
 */
const PLANT_QUALIFIERS = [
  "vegan",
  "vegetarian",
  "veggie",
  "plant-based",
  "meatless",
  "meat-free",
  "seitan",
  "jackfruit",
  "microbial",
];

/** Poultry followed by egg(s) is an egg, which the egg allergen covers. */
const EGG_SUFFIX = /^[\s-]+eggs?(?:$|[\s,;/()-])/;

/**
 * "meat-free" / "meat free" names a substitute, not meat. "meat free-range" /
 * "meat free range" is real meat, so the lookahead refuses "free" + "range".
 */
const MEAT_FREE_SUFFIX = /^[\s-]+free(?![\s-]*range)(?:$|[\s,;/()-])/;

const QUALIFIER_BEFORE = new RegExp(
  `(?:^|[\\s,;/()\\-])(?:${PLANT_QUALIFIERS.join("|")})[\\s\\-]$`,
  "i",
);

const occurrencePatternCache = new Map<string, RegExp>();

/** Every whole-word occurrence of `keyword` (lookarounds, so none is consumed). */
function occurrencePattern(keyword: string): RegExp {
  let pattern = occurrencePatternCache.get(keyword);
  if (!pattern) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(
      `(?<=^|[\\s,;/()\\-])${escaped}(?=$|[\\s,;/()\\-])`,
      "gi",
    );
    occurrencePatternCache.set(keyword, pattern);
  }
  return pattern;
}

/**
 * Judges EACH occurrence: one unqualified occurrence flags, so "chicken egg
 * noodles with chicken" is poultry even though the first "chicken" is an egg.
 */
function conflictKeywordHits(
  lower: string,
  keyword: string,
  id: DietConflictId,
): boolean {
  if (!ingredientContainsKeyword(lower, keyword)) return false;
  let sawOccurrence = false;
  for (const m of lower.matchAll(occurrencePattern(keyword))) {
    sawOccurrence = true;
    const before = lower.slice(0, m.index);
    const after = lower.slice(m.index + keyword.length);
    if (QUALIFIER_BEFORE.test(before)) continue;
    if (id === "poultry" && EGG_SUFFIX.test(after)) continue;
    if (keyword === "meat" && MEAT_FREE_SUFFIX.test(after)) continue;
    return true;
  }
  // Contains-check passed but no whole-word occurrence (e.g. a multi-word
  // substring): when in doubt, flag.
  return !sawOccurrence;
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
