import { z } from "zod";
import { allergySchema } from "@shared/schema";

// ============================================================================
// ALLERGEN ID & SEVERITY (matches COMMON_ALLERGENS in dietary-options.ts)
// ============================================================================

export const allergenIds = [
  "peanuts",
  "tree_nuts",
  "milk",
  "eggs",
  "wheat",
  "soy",
  "fish",
  "shellfish",
  "sesame",
] as const;

export const allergenIdSchema = z.enum(allergenIds);
export type AllergenId = z.infer<typeof allergenIdSchema>;

export const allergySeverities = ["mild", "moderate", "severe"] as const;
export const allergySeveritySchema = z.enum(allergySeverities);
export type AllergySeverity = z.infer<typeof allergySeveritySchema>;

// ============================================================================
// ALLERGEN DEFINITIONS (direct vs. derived ingredients)
// ============================================================================

export interface AllergenDefinition {
  id: AllergenId;
  label: string;
  /** Obvious ingredient names — always flagged regardless of severity. */
  directIngredients: string[];
  /** Hidden/processed derivatives — flagged only for moderate+ severity. */
  derivedIngredients: string[];
}

/**
 * Maps each allergen to the ingredient keywords it covers. Two tiers:
 *
 * - **direct**: common whole-food names a consumer would recognize.
 * - **derived**: processed derivatives that may not be obvious on a label.
 *   Only surfaced when the user's severity is moderate or severe.
 */
export const ALLERGEN_INGREDIENT_MAP: Record<AllergenId, AllergenDefinition> = {
  peanuts: {
    id: "peanuts",
    label: "Peanuts",
    directIngredients: [
      "peanut",
      "peanuts",
      "peanut butter",
      "peanut oil",
      "groundnut",
      "groundnuts",
      "monkey nut",
      "monkey nuts",
      "beer nut",
      "beer nuts",
      "peanut flour",
      "peanut sauce",
    ],
    derivedIngredients: [
      "arachis oil",
      "arachis hypogaea",
      "hydrolyzed peanut protein",
      "peanut extract",
    ],
  },

  tree_nuts: {
    id: "tree_nuts",
    label: "Tree Nuts",
    directIngredients: [
      "almond",
      "almonds",
      "cashew",
      "cashews",
      "walnut",
      "walnuts",
      "pecan",
      "pecans",
      "pistachio",
      "pistachios",
      "hazelnut",
      "hazelnuts",
      "macadamia",
      "macadamias",
      "brazil nut",
      "brazil nuts",
      "pine nut",
      "pine nuts",
      "chestnut",
      "chestnuts",
      "almond butter",
      "almond milk",
      "almond flour",
      "cashew butter",
      "cashew milk",
      "walnut oil",
      "hazelnut spread",
      "praline",
      "pralines",
      "marzipan",
      "nougat",
      "gianduja",
    ],
    derivedIngredients: [
      "nut extract",
      "nut oil",
      "nut paste",
      "nut meal",
      "mandelonas",
      "nutella",
    ],
  },

  milk: {
    id: "milk",
    label: "Dairy/Milk",
    directIngredients: [
      "milk",
      "milks",
      "cheese",
      "cheeses",
      "butter",
      "butters",
      "cream",
      "creams",
      "yogurt",
      "yogurts",
      "yoghurt",
      "yoghurts",
      "ghee",
      "ice cream",
      "sour cream",
      "cream cheese",
      "cottage cheese",
      "ricotta",
      "mozzarella",
      "parmesan",
      "cheddar",
      "gouda",
      "brie",
      "feta",
      "mascarpone",
      "paneer",
      "buttermilk",
      "half-and-half",
      "heavy cream",
      "whipped cream",
      "condensed milk",
      "evaporated milk",
      "whole milk",
      "skim milk",
      "custard",
      "custards",
    ],
    derivedIngredients: [
      "whey",
      "casein",
      "caseinate",
      "lactose",
      "lactalbumin",
      "lactoglobulin",
      "milk protein",
      "milk solids",
      "milk powder",
      "sodium caseinate",
      "calcium caseinate",
      "curds",
      "rennet",
      "galactose",
      "hydrolyzed milk protein",
      "milk fat",
      "anhydrous milk fat",
      "ghee solids",
    ],
  },

  eggs: {
    id: "eggs",
    label: "Eggs",
    directIngredients: [
      "egg",
      "eggs",
      "egg white",
      "egg whites",
      "egg yolk",
      "egg yolks",
      "scrambled egg",
      "scrambled eggs",
      "hard-boiled egg",
      "hard-boiled eggs",
      "omelette",
      "omelettes",
      "frittata",
      "frittatas",
      "quiche",
      "quiches",
      "meringue",
      "meringues",
      "mayonnaise",
      "aioli",
      "hollandaise",
      "eggnog",
    ],
    derivedIngredients: [
      "albumin",
      "globulin",
      "lysozyme",
      "ovalbumin",
      "ovomucin",
      "ovomucoid",
      "ovovitellin",
      "livetin",
      "egg lecithin",
      "egg protein",
      "egg solids",
      "dried egg",
      "powdered egg",
    ],
  },

  wheat: {
    id: "wheat",
    label: "Wheat/Gluten",
    directIngredients: [
      "wheat",
      "flour",
      "flours",
      "bread",
      "pasta",
      "noodle",
      "noodles",
      "spaghetti",
      "macaroni",
      "couscous",
      "bulgur",
      "farina",
      "semolina",
      "durum",
      "spelt",
      "farro",
      "kamut",
      "einkorn",
      "cracker",
      "crackers",
      "breadcrumb",
      "breadcrumbs",
      "panko",
      "tortilla",
      "tortillas",
      "pita",
      "pitas",
      "naan",
      "croissant",
      "croissants",
      "baguette",
      "baguettes",
      "crouton",
      "croutons",
      "seitan",
      "orzo",
      "ramen",
      "udon",
    ],
    derivedIngredients: [
      "gluten",
      "vital wheat gluten",
      "wheat starch",
      "wheat germ",
      "wheat bran",
      "wheat protein",
      "hydrolyzed wheat protein",
      "modified food starch",
      "malt",
      "malt extract",
      "malt flavoring",
      "maltodextrin",
      "triticale",
    ],
  },

  soy: {
    id: "soy",
    label: "Soy",
    directIngredients: [
      "soy",
      "soybean",
      "soybeans",
      "soy sauce",
      "soy milk",
      "tofu",
      "tempeh",
      "edamame",
      "miso",
      "soy yogurt",
      "soy cream",
      "soy cheese",
      "tamari",
    ],
    derivedIngredients: [
      "soy lecithin",
      "soy protein",
      "soy protein isolate",
      "soy flour",
      "soy oil",
      "soybean oil",
      "hydrolyzed soy protein",
      "textured vegetable protein",
      "tvp",
    ],
  },

  fish: {
    id: "fish",
    label: "Fish",
    directIngredients: [
      "fish",
      "salmon",
      "tuna",
      "cod",
      "tilapia",
      "trout",
      "halibut",
      "mackerel",
      "sardine",
      "sardines",
      "anchovy",
      "anchovies",
      "bass",
      "catfish",
      "haddock",
      "herring",
      "herrings",
      "mahi-mahi",
      "perch",
      "pollock",
      "snapper",
      "snappers",
      "sole",
      "swordfish",
      "pike",
      "grouper",
      "groupers",
      "caviar",
      "roe",
    ],
    derivedIngredients: [
      "fish sauce",
      "fish oil",
      "fish paste",
      "fish stock",
      "fish gelatin",
      "fish extract",
      "omega-3 fish oil",
      "surimi",
      "bonito",
      "dashi",
      "fumet",
      "isinglass",
      "worcestershire sauce",
    ],
  },

  shellfish: {
    id: "shellfish",
    label: "Shellfish",
    directIngredients: [
      "shrimp",
      "shrimps",
      "prawn",
      "prawns",
      "crab",
      "crabs",
      "lobster",
      "lobsters",
      "crayfish",
      "crawfish",
      "scallop",
      "scallops",
      "clam",
      "clams",
      "mussel",
      "mussels",
      "oyster",
      "oysters",
      "squid",
      "calamari",
      "octopus",
      "octopuses",
      "abalone",
      "snail",
      "snails",
      "escargot",
      "escargots",
      "langoustine",
      "langoustines",
    ],
    derivedIngredients: [
      "shellfish extract",
      "shrimp paste",
      "crab paste",
      "oyster sauce",
      "lobster bisque",
      "crab stock",
      "shrimp powder",
      "chitin",
      "chitosan",
      "glucosamine",
    ],
  },

  sesame: {
    id: "sesame",
    label: "Sesame",
    directIngredients: [
      "sesame",
      "sesame seed",
      "sesame seeds",
      "sesame oil",
      "tahini",
      "halva",
      "halvah",
      "hummus",
      "sesame paste",
      "sesame butter",
    ],
    derivedIngredients: [
      "sesame flour",
      "sesame protein",
      "sesamol",
      "sesamolin",
      "gingelly oil",
      "til oil",
      "benne seed",
      "benne seeds",
    ],
  },
};

// ============================================================================
// ALLERGEN DETECTION (pure function — zero API cost)
// ============================================================================

export interface AllergenMatch {
  /** Which allergen was triggered. */
  allergenId: AllergenId;
  /** The user's declared severity for this allergen. */
  severity: AllergySeverity;
  /** The original ingredient name that triggered the match. */
  ingredientName: string;
  /** The specific keyword from the mapping that matched. */
  matchedKeyword: string;
  /** Whether the match came from the derived (hidden) ingredient list. */
  isDerived: boolean;
}

/**
 * Scans an ingredient list against a user's declared allergies.
 *
 * - **Mild** severity: only `directIngredients` are flagged.
 * - **Moderate / Severe**: both `direct` and `derivedIngredients` are flagged.
 *
 * Matching is case-insensitive and uses word-boundary–aware substring search
 * so that "cod" doesn't falsely match "avocado".
 */
export function detectAllergens(
  ingredientNames: string[],
  userAllergies: readonly { name: string; severity: AllergySeverity }[],
): AllergenMatch[] {
  if (userAllergies.length === 0 || ingredientNames.length === 0) return [];

  const matches: AllergenMatch[] = [];

  for (const allergy of userAllergies) {
    const allergenId = normalizeAllergenId(allergy.name);
    if (!allergenId) continue;

    const definition = ALLERGEN_INGREDIENT_MAP[allergenId];
    const includeDerived =
      allergy.severity === "moderate" || allergy.severity === "severe";

    const keywords = includeDerived
      ? [...definition.directIngredients, ...definition.derivedIngredients]
      : definition.directIngredients;

    for (const ingredientName of ingredientNames) {
      const lower = ingredientName.toLowerCase();

      for (const keyword of keywords) {
        if (ingredientContainsKeyword(lower, keyword)) {
          matches.push({
            allergenId,
            severity: allergy.severity,
            ingredientName,
            matchedKeyword: keyword,
            isDerived: definition.derivedIngredients.includes(keyword),
          });
          // One match per ingredient–allergen pair is enough
          break;
        }
      }
    }
  }

  return matches;
}

/**
 * A single derived allergen entry for a recipe.
 *
 * `viaDerived` is `false` when at least one *direct-tier* keyword matched, and
 * `true` when only *derived-tier* (hidden/processed) keywords matched. Direct
 * wins if both tiers match — a recipe with whole peanuts is `viaDerived: false`
 * even if it also contains "peanut extract".
 */
export interface DerivedRecipeAllergen {
  id: AllergenId;
  viaDerived: boolean;
}

/**
 * Recipe-side complement to `detectAllergens`. Scans an ingredient list against
 * ALL allergens (both tiers, severity-independent) and returns which allergens
 * the recipe carries. The result is the denormalized `allergens` column cache.
 *
 * Unlike `detectAllergens` (which takes a user's allergies + severity), this
 * derives the recipe's full allergen profile so the search predicate can apply
 * any user's severity matrix at query time.
 */
export function deriveRecipeAllergens(
  ingredientNames: string[],
): DerivedRecipeAllergen[] {
  if (ingredientNames.length === 0) return [];

  const lowerIngredients = ingredientNames.map((n) => n.toLowerCase());
  const result: DerivedRecipeAllergen[] = [];

  for (const definition of Object.values(ALLERGEN_INGREDIENT_MAP)) {
    let directHit = false;
    let derivedHit = false;

    for (const lower of lowerIngredients) {
      if (!directHit) {
        for (const keyword of definition.directIngredients) {
          if (ingredientContainsKeyword(lower, keyword)) {
            directHit = true;
            break;
          }
        }
      }
      if (!derivedHit) {
        for (const keyword of definition.derivedIngredients) {
          if (ingredientContainsKeyword(lower, keyword)) {
            derivedHit = true;
            break;
          }
        }
      }
      if (directHit && derivedHit) break;
    }

    if (directHit || derivedHit) {
      // Direct wins: a direct-tier hit means viaDerived is false.
      result.push({ id: definition.id, viaDerived: !directHit });
    }
  }

  return result;
}

/**
 * Recipe-side safety gate for the "Safe for me" search filter.
 *
 * Given a recipe's derived allergen cache and a user's declared allergies,
 * returns `false` if the recipe is unsafe for that user. A recipe is unsafe
 * when, for ANY of the user's allergies, the recipe carries that allergen AND:
 *
 * - the user's severity is `moderate` or `severe` (hidden derivatives matter), OR
 * - the recipe's entry is a *direct-tier* hit (`viaDerived: false`) — an obvious
 *   ingredient is unsafe even at `mild` severity.
 *
 * A `mild` allergy is therefore tolerant of derived-only hits but not direct
 * hits — mirroring `detectAllergens`'s severity tiering from the recipe side.
 *
 * Fail-closed on un-derived recipes: a `null` allergen cache means the recipe
 * has not been analyzed yet, so it is treated as UNSAFE — never presented as
 * safe on a guess. `[]` is distinct: it means "analyzed, genuinely carries no
 * allergens" = safe.
 *
 * NOTE: this does NOT handle the empty-ingredient case (a recipe analyzed with
 * zero ingredient data — `deriveRecipeAllergens([])` yields `[]`, which reads
 * as safe here). Conservative exclusion of such recipes is the caller's
 * responsibility — see `searchRecipes`'s `safeForMe` predicate.
 */
export function isRecipeSafeForAllergies(
  recipeAllergens: readonly DerivedRecipeAllergen[] | null,
  userAllergies: readonly { name: string; severity: AllergySeverity }[],
): boolean {
  if (userAllergies.length === 0) return true;
  // `null` = not yet derived — fail closed: never shown as safe on a guess.
  if (recipeAllergens === null) return false;
  if (recipeAllergens.length === 0) return true;

  for (const allergy of userAllergies) {
    const allergenId = normalizeAllergenId(allergy.name);
    if (!allergenId) continue;

    const entry = recipeAllergens.find((a) => a.id === allergenId);
    if (!entry) continue;

    const includeDerived =
      allergy.severity === "moderate" || allergy.severity === "severe";

    // Direct-tier hits are always unsafe. Derived-tier hits are unsafe only
    // for moderate/severe severity.
    if (!entry.viaDerived || includeDerived) return false;
  }

  return true;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Common label variants → canonical AllergenId. Hoisted to module scope. */
const ALLERGEN_LABEL_MAP: Record<string, AllergenId> = {
  peanut: "peanuts",
  "tree nut": "tree_nuts",
  "tree nuts": "tree_nuts",
  nut: "tree_nuts",
  dairy: "milk",
  "dairy/milk": "milk",
  milk: "milk",
  lactose: "milk",
  egg: "eggs",
  gluten: "wheat",
  "wheat/gluten": "wheat",
  soybean: "soy",
  "soy bean": "soy",
  seafood: "fish",
  crustacean: "shellfish",
  "sesame seed": "sesame",
};

/**
 * Normalise the allergy name from the user profile (e.g. "Dairy/Milk", "milk",
 * "Wheat/Gluten") to our canonical AllergenId.
 */
export function normalizeAllergenId(name: string): AllergenId | null {
  const lower = name.toLowerCase().trim();

  // Direct ID match (e.g. stored as "peanuts", "tree_nuts")
  if (allergenIds.includes(lower as AllergenId)) return lower as AllergenId;

  return ALLERGEN_LABEL_MAP[lower] ?? null;
}

/**
 * Pre-compiled regex cache for single-word keywords.
 * Built once at module load to avoid compiling regex in hot loops.
 */
const keywordPatternCache = new Map<string, RegExp>();

function getKeywordPattern(keyword: string): RegExp {
  let pattern = keywordPatternCache.get(keyword);
  if (!pattern) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(
      `(?:^|[\\s,;/()\\-])${escaped}(?:$|[\\s,;/()\\-])`,
      "i",
    );
    keywordPatternCache.set(keyword, pattern);
  }
  return pattern;
}

// Pre-populate the cache at module load time
for (const def of Object.values(ALLERGEN_INGREDIENT_MAP)) {
  for (const kw of [...def.directIngredients, ...def.derivedIngredients]) {
    if (!kw.includes(" ")) {
      getKeywordPattern(kw);
    }
  }
}

/**
 * Bare keywords that name a dairy/wheat staple on their own ("milk", "butter")
 * but also appear inside plant substitutes ("almond milk", "oat flour"). When
 * one of these is immediately preceded by a plant qualifier, the ingredient is
 * a substitute that carries NONE of the dairy/wheat allergen — see the guard in
 * `ingredientContainsKeyword`.
 */
const MODIFIER_SENSITIVE_KEYWORDS = new Set([
  "milk",
  "milks",
  "cream",
  "creams",
  "butter",
  "butters",
  "flour",
  "flours",
]);

/**
 * STRICTLY plant-based qualifiers. Animal-milk qualifiers (goat, sheep, buffalo,
 * camel) are deliberately excluded — those ARE dairy, so suppressing them would
 * turn a safe over-flag into a dangerous under-flag. Suppression only removes
 * the dairy/wheat allergen; the substitute's OWN allergen still matches via its
 * own keyword (e.g. "almond milk" loses dairy but keeps tree_nut via "almond").
 *
 * Gluten-free flour bases (oat, rice, corn, buckwheat, …) suppress the *wheat*
 * keyword by ingredient-text semantics: "oat flour" does not assert wheat in the
 * ingredient string. Cross-contamination ("may contain wheat") is a separate
 * advisory channel, not derivable from the ingredient name. Gluten-containing
 * grains (wheat/spelt/rye/barley) are intentionally NOT in this list, so
 * "spelt flour"/"rye flour" still flag.
 */
const SUBSTITUTE_MODIFIERS = [
  "almond",
  "cashew",
  "hazelnut",
  "macadamia",
  "pistachio",
  "walnut",
  "peanut",
  "coconut",
  "oat",
  "soy",
  "soya",
  "soybean",
  "rice",
  "hemp",
  "pea",
  "sunflower",
  "flax",
  "chia",
  "sesame",
  "cocoa",
  "shea",
  "chickpea",
  "garbanzo",
  "corn",
  "tapioca",
  "cassava",
  "buckwheat",
  "millet",
  "sorghum",
  "quinoa",
  "amaranth",
  "teff",
  "potato",
  "plantain",
];

const substituteModifierPatternCache = new Map<string, RegExp>();

function getSubstituteModifierPattern(keyword: string): RegExp {
  let pattern = substituteModifierPatternCache.get(keyword);
  if (!pattern) {
    const mods = SUBSTITUTE_MODIFIERS.join("|");
    // <plant qualifier><within-token joiner><keyword> at word boundaries, e.g.
    // "almond milk", "unsweetened oat-milk", "coconut flour", "almond/milk".
    // The inner join accepts only WITHIN-TOKEN joiners — space, hyphen, slash —
    // that bind one compound substitute name. It deliberately EXCLUDES the
    // ingredient delimiters "," and ";" (which separate distinct list items:
    // "almond, milk" is almond AND genuine milk, so the milk must still flag)
    // and parentheses (ambiguous — over-flagging is the safe default).
    pattern = new RegExp(
      `(?:^|[\\s,;/()\\-])(?:${mods})[\\s/\\-]${keyword}(?:$|[\\s,;/()\\-])`,
      "i",
    );
    substituteModifierPatternCache.set(keyword, pattern);
  }
  return pattern;
}

/**
 * Word-boundary–aware substring match.
 *
 * Prevents "cod" from matching "avocado" by requiring the keyword to appear
 * at a word boundary (start of string, space, hyphen, slash, or parenthesis).
 * Single-word keywords use regex boundaries; multi-word keywords use simple
 * `includes()` since they're specific enough.
 *
 * Plant-substitute guard: a bare dairy/wheat keyword preceded by a plant
 * qualifier ("almond milk", "oat flour") names a substitute that carries none
 * of that allergen, so it does NOT match. The substitute's own allergen still
 * matches through its own keyword.
 */
function ingredientContainsKeyword(
  lowerIngredient: string,
  keyword: string,
): boolean {
  if (keyword.includes(" ")) {
    // Multi-word keyword — specific enough for simple substring
    return lowerIngredient.includes(keyword);
  }

  // Also match if the entire ingredient IS the keyword
  if (lowerIngredient === keyword) return true;

  // Single-word keyword — use pre-compiled word boundary pattern
  if (!getKeywordPattern(keyword).test(lowerIngredient)) return false;

  if (
    MODIFIER_SENSITIVE_KEYWORDS.has(keyword) &&
    getSubstituteModifierPattern(keyword).test(lowerIngredient)
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// SHARED JSONB PARSING (eliminates inline safeParse loops across 5+ files)
// ============================================================================

/**
 * Safely parse the `userProfiles.allergies` JSONB column into typed allergy
 * objects. Invalid entries are silently skipped — partial corruption doesn't
 * crash the request.
 *
 * Use this instead of inline `as` casts or manual safeParse loops.
 */
export function parseUserAllergies(
  raw: unknown,
): { name: string; severity: AllergySeverity }[] {
  if (!Array.isArray(raw)) return [];
  const result: { name: string; severity: AllergySeverity }[] = [];
  for (const item of raw) {
    const parsed = allergySchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

/** Exported for testing. */
export const _testInternals = {
  normalizeAllergenId,
  ingredientContainsKeyword,
};
