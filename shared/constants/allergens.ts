import { z } from "zod";

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
      "peanut butter",
      "peanut oil",
      "groundnut",
      "monkey nut",
      "beer nut",
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
      "cashew",
      "walnut",
      "pecan",
      "pistachio",
      "hazelnut",
      "macadamia",
      "brazil nut",
      "pine nut",
      "chestnut",
      "almond butter",
      "almond milk",
      "almond flour",
      "cashew butter",
      "cashew milk",
      "walnut oil",
      "hazelnut spread",
      "praline",
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
      "cheese",
      "butter",
      "cream",
      "yogurt",
      "yoghurt",
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
      "egg yolk",
      "scrambled egg",
      "hard-boiled egg",
      "omelette",
      "frittata",
      "quiche",
      "meringue",
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
      "bread",
      "pasta",
      "noodle",
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
      "breadcrumb",
      "panko",
      "tortilla",
      "pita",
      "naan",
      "croissant",
      "baguette",
      "crouton",
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
      "anchovy",
      "anchovies",
      "bass",
      "catfish",
      "haddock",
      "herring",
      "mahi-mahi",
      "perch",
      "pollock",
      "snapper",
      "sole",
      "swordfish",
      "pike",
      "grouper",
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
      "prawn",
      "crab",
      "lobster",
      "crayfish",
      "crawfish",
      "scallop",
      "clam",
      "mussel",
      "oyster",
      "squid",
      "calamari",
      "octopus",
      "abalone",
      "snail",
      "escargot",
      "langoustine",
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
function normalizeAllergenId(name: string): AllergenId | null {
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
 * Word-boundary–aware substring match.
 *
 * Prevents "cod" from matching "avocado" by requiring the keyword to appear
 * at a word boundary (start of string, space, hyphen, slash, or parenthesis).
 * Single-word keywords use regex boundaries; multi-word keywords use simple
 * `includes()` since they're specific enough.
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
  return getKeywordPattern(keyword).test(lowerIngredient);
}

/** Exported for testing. */
export const _testInternals = {
  normalizeAllergenId,
  ingredientContainsKeyword,
};
