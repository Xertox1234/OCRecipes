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
  /**
   * Foods that MAY carry the allergen depending on the recipe or brand
   * ("cookies", "chocolate"). Reported as "possible", never as "contains";
   * the person with the allergy decides (owner ruling 2026-11-15).
   */
  possibleIngredients: string[];
}

/**
 * Maps each allergen to the ingredient keywords it covers. Three tiers:
 *
 * - **direct**: common whole-food names a consumer would recognize.
 * - **derived**: processed derivatives that may not be obvious on a label.
 *   Only surfaced when the user's severity is moderate or severe.
 * - **possible**: foods that often, but not always, carry the allergen.
 *   Surfaced at every severity as a "possible" warning. Direct and derived
 *   win over possible when both match.
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "satay",
      "kung pao",
      "gado gado",
      "mixed nuts",
    ],
    derivedIngredients: [
      "arachis oil",
      "arachis hypogaea",
      "hydrolyzed peanut protein",
      "peanut extract",
    ],
    possibleIngredients: [
      "trail mix",
      "mole",
      "granola",
      "pad thai",
      "egg roll",
      "nougat",
      "energy bar",
      "candy bar",
      "massaman curry",
      "brittle",
      "cereal",
      "cereals",
      "cookie",
      "cookies",
      "dan dan noodles",
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "baklava",
      "frangipane",
      "amaretti",
      "mixed nuts",
      "turron",
      "turrón",
      "romesco",
      "dukkah",
      "macaron",
      "macarons",
    ],
    derivedIngredients: [
      "nut extract",
      "nut oil",
      "nut paste",
      "nut meal",
      "mandelonas",
      "nutella",
    ],
    possibleIngredients: [
      "pesto",
      "granola",
      "muesli",
      "trail mix",
      "amaretto",
      "macaroon",
      "macaroons",
      "mortadella",
      "mole",
      "biscotti",
      "energy bar",
      "korma",
      "pilaf",
      "fruitcake",
      "brownie",
      "brownies",
      "chocolate spread",
      "cereal",
      "cereals",
      "cookie",
      "cookies",
      "ice cream",
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
      // Pesto is made with parmesan (owner ruling 2026-10-17). "Vegan pesto"
      // over-flags; accepted (safe direction).
      "pesto",
      // Dishes and sauces that carry it by definition (2026-11-15).
      "queso",
      "lassi",
      "kefir",
      "bechamel",
      "béchamel",
      "alfredo",
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
    possibleIngredients: [
      "chocolate",
      "caramel",
      "pudding",
      "frosting",
      "ranch",
      "nougat",
      "sherbet",
      "whipped topping",
      "creamer",
      "margarine",
      "toffee",
      "fudge",
      "mashed potatoes",
      "chowder",
      "gratin",
      "pizza",
      "cocoa mix",
      "protein powder",
      "naan",
      "brioche",
      "croissant",
      "croissants",
      "pancake mix",
      "biscuit",
      "biscuits",
      "cake",
      "cakes",
      "caesar dressing",
      "white sauce",
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "mayo",
      "custard",
      "souffle",
      "soufflé",
      "lemon curd",
      "royal icing",
      "french toast",
      "tartar sauce",
      "macaron",
      "macarons",
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
    possibleIngredients: [
      "marshmallow",
      "marshmallows",
      "fresh pasta",
      "noodles",
      "caesar dressing",
      "brioche",
      "challah",
      "cake",
      "cakes",
      "cookie",
      "cookies",
      "muffin",
      "muffins",
      "pancake",
      "pancakes",
      "waffle",
      "waffles",
      "crepe",
      "crepes",
      "meatball",
      "meatballs",
      "meatloaf",
      "batter",
      "breaded",
      "tempura",
      "mousse",
      "ice cream",
      "nougat",
      "macaroon",
      "macaroons",
      "pudding",
      "frosting",
      "pretzel",
      "pretzels",
      "doughnut",
      "doughnuts",
      "donut",
      "donuts",
      "ramen",
      "pad thai",
      "fried rice",
      "surimi",
      "ranch",
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
      // Gluten grains and gluten-brewed foods (owner ruling 2026-10-17): the
      // label is "Wheat/Gluten", and the gluten-free icon reads this list as an
      // absence claim. Bare "ale" is deliberately absent — "ginger ale" has no
      // gluten. "gluten-free soy sauce" over-flags; accepted (safe direction).
      "barley",
      "rye",
      "beer",
      "lager",
      "stout",
      "soy sauce",
      "teriyaki",
      // Wheat foods named by their form. Bare "crust" and "dough" stay out:
      // they would flag "almond crust" and "cauliflower crust". The two-word
      // entries match by substring, so "gluten-free pie crust" over-flags;
      // accepted (safe direction).
      "pie crust",
      "pizza dough",
      "brioche",
      "brioches",
      // Common wheat foods (owner batch 2026-11-14). Names that also cover
      // gluten-free dishes stay out: "cake" (rice cake, crab cake), "cookie",
      // "muffin", "biscuit", "cereal", "gravy", "stuffing", "toast", "roll".
      // A gluten-free version of a listed food over-flags; accepted (safe
      // direction).
      "bagel",
      "bagels",
      "sourdough",
      "ciabatta",
      "focaccia",
      "challah",
      "flatbread",
      "flatbreads",
      "bun",
      "buns",
      "dinner roll",
      "english muffin",
      "matzo",
      "matzah",
      "matzoh",
      "pretzel",
      "pretzels",
      "penne",
      "fettuccine",
      "fettuccini",
      "linguine",
      "linguini",
      "ravioli",
      "tortellini",
      "lasagna",
      "lasagne",
      "gnocchi",
      "rigatoni",
      "fusilli",
      "tagliatelle",
      "pappardelle",
      "farfalle",
      "ziti",
      "rotini",
      "cannelloni",
      "manicotti",
      "pastry",
      "pastries",
      "phyllo",
      "filo",
      "pizza crust",
      "pizza base",
      "biscotti",
      "shortbread",
      "scone",
      "scones",
      "doughnut",
      "doughnuts",
      "donut",
      "donuts",
      "strudel",
      "dumpling",
      "dumplings",
      "wonton",
      "wontons",
      "gyoza",
      "potsticker",
      "potstickers",
      "egg roll wrapper",
      "freekeh",
      "wheatberry",
      "wheatberries",
      "strudels",
      "matzos",
      "matzahs",
      "ciabattas",
      "focaccias",
      "challahs",
      "lasagnas",
      "gyozas",
      "shortbreads",
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
      // Oats carry no gluten of their own but are routinely cross-contaminated
      // with wheat, so they count as a gluten risk everywhere (owner ruling
      // 2026-10-16). Derived tier: flagged for moderate/severe, not mild.
      // Single-word keywords match whole words only, so compounds are listed.
      "oat",
      "oats",
      "oatmeal",
      "oatcake",
      "oatcakes",
    ],
    possibleIngredients: [
      "cake",
      "cakes",
      "cookie",
      "cookies",
      "muffin",
      "muffins",
      "biscuit",
      "biscuits",
      "cereal",
      "cereals",
      "granola",
      "gravy",
      "stuffing",
      "toast",
      "sandwich",
      "sandwiches",
      "rolls",
      "pancake mix",
      "pancake",
      "pancakes",
      "waffle",
      "waffles",
      "crepe",
      "crepes",
      "wafer",
      "wafers",
      "cone",
      "cones",
      "pie shell",
      "tart shell",
      "breading",
      "breaded",
      "roux",
      "soba",
      "lo mein",
      "vermicelli",
      "graham",
      "rusk",
      "rusks",
      "batter",
      "tempura",
      "meatball",
      "meatballs",
      "meatloaf",
      "sausage",
      "sausages",
      "bouillon",
      "stock cube",
      "brownie",
      "brownies",
      "licorice",
      "surimi",
      "miso",
      "worcestershire",
      "hoisin",
      "oyster sauce",
      "cream of mushroom soup",
      "veggie burger",
      "fish sticks",
      "chicken nuggets",
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "teriyaki",
      "hoisin",
      "ponzu",
      "natto",
      "gochujang",
      "black bean sauce",
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
    possibleIngredients: [
      "worcestershire",
      "vegetable broth",
      "bouillon",
      "oyster sauce",
      "veggie burger",
      "vegan cheese",
      "vegan sausage",
      "imitation bacon",
      "margarine",
      "shortening",
      "mayonnaise",
      "chocolate",
      "protein bar",
      "protein powder",
      "stir fry sauce",
      "stir-fry sauce",
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "nam pla",
      "taramasalata",
      "bouillabaisse",
      "imitation crab",
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
    possibleIngredients: [
      "caesar dressing",
      "kimchi",
      "curry paste",
      "oyster sauce",
      "tapenade",
      "puttanesca",
      "caponata",
      "furikake",
      "pad thai",
      "som tam",
      "gumbo",
      "paella",
      "sushi",
      "ramen",
      "miso soup",
      "xo sauce",
      "sambal",
      "remoulade",
      "rémoulade",
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
      "shellfish",
      "crustacean",
      "crustaceans",
      // Dishes and sauces that carry it by definition (2026-11-15).
      "belacan",
      "cioppino",
      "etouffee",
      "étouffée",
      "seafood stock",
      "xo sauce",
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
    possibleIngredients: [
      "kimchi",
      "curry paste",
      "paella",
      "surimi",
      "fish sauce",
      "gumbo",
      "jambalaya",
      "bouillabaisse",
      "pad thai",
      "sambal",
      "fish stock",
      "tom yum",
      "laksa",
      "fried rice",
      "egg roll",
      "dumpling",
      "dumplings",
      "wonton",
      "wontons",
      "sushi",
      "ramen",
      "bisque",
      "chowder",
      "seafood seasoning",
      "ceviche",
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
      // Dishes and sauces that carry it by definition (2026-11-15).
      "furikake",
      "gomasio",
      "za'atar",
      "zaatar",
      "dukkah",
      "goma",
      "benne",
      "baba ganoush",
      "everything bagel",
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
    possibleIngredients: [
      "bagel",
      "bagels",
      "falafel",
      "burger bun",
      "sushi",
      "granola",
      "breadsticks",
      "crackers",
      "bibimbap",
      "stir fry",
      "stir-fry",
      "teriyaki",
      "hoisin",
      "chili oil",
      "dan dan noodles",
      "ramen",
      "poke",
      "seaweed salad",
      "energy bar",
      "veggie burger",
      "pretzel",
      "pretzels",
      "challah",
      "dumpling sauce",
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
  /**
   * True when only a possible-tier keyword matched: the ingredient MAY carry
   * the allergen. Word it as "possible", never "contains".
   */
  isPossible: boolean;
}

/**
 * Whether a match should stop something being offered or shown as safe, as
 * opposed to only raising a warning. Definite matches always block. A
 * possible match blocks for moderate and severe allergies and only warns for
 * mild ones — the same line `isRecipeSafeForAllergies` draws. A match with no
 * `isPossible` field (older data) blocks.
 */
export function isBlockingAllergenMatch(
  match: Pick<AllergenMatch, "severity"> & { isPossible?: boolean },
): boolean {
  return match.isPossible !== true || match.severity !== "mild";
}

/**
 * One match per ingredient, for surfaces that show a single flag per row.
 * A definite match wins over a possible one; within a kind, the first match
 * in `matches` order wins.
 */
export function firstMatchPerIngredient(
  matches: readonly AllergenMatch[],
): Map<string, AllergenMatch> {
  const map = new Map<string, AllergenMatch>();
  for (const m of matches) {
    const current = map.get(m.ingredientName);
    if (!current || (current.isPossible === true && m.isPossible !== true)) {
      map.set(m.ingredientName, m);
    }
  }
  return map;
}

/**
 * Scans an ingredient list against a user's declared allergies.
 *
 * - **Mild** severity: only `directIngredients` are flagged.
 * - **Moderate / Severe**: both `direct` and `derivedIngredients` are flagged.
 * - **Every severity**: `possibleIngredients` are reported with
 *   `isPossible: true`, but only when no definite keyword matched the same
 *   ingredient. Callers that block (not just warn) use
 *   `isBlockingAllergenMatch`.
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

    const definiteKeywords = includeDerived
      ? [...definition.directIngredients, ...definition.derivedIngredients]
      : definition.directIngredients;

    for (const ingredientName of ingredientNames) {
      const lower = ingredientName.toLowerCase();

      // One match per ingredient–allergen pair is enough. Definite keywords
      // are tried first, so "wheat flour cookies" is a definite match.
      const definite = definiteKeywords.find((keyword) =>
        ingredientContainsKeyword(lower, keyword),
      );
      if (definite !== undefined) {
        matches.push({
          allergenId,
          severity: allergy.severity,
          ingredientName,
          matchedKeyword: definite,
          isDerived: definition.derivedIngredients.includes(definite),
          isPossible: false,
        });
        continue;
      }

      const possible = definition.possibleIngredients.find((keyword) =>
        ingredientContainsKeyword(lower, keyword),
      );
      if (possible !== undefined) {
        matches.push({
          allergenId,
          severity: allergy.severity,
          ingredientName,
          matchedKeyword: possible,
          isDerived: false,
          isPossible: true,
        });
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
  /**
   * Present (always `true`) when ONLY possible-tier keywords matched: the
   * recipe MAY carry the allergen. Such an entry also has `viaDerived: true`,
   * so a reader that does not know this field treats it as a hidden-tier hit
   * — stronger wording, never weaker — and `isRecipeSafeForAllergies` already
   * hides it from moderate and severe allergies and keeps it for mild ones.
   * Absent on definite entries.
   */
  possible?: true;
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
    let possibleHit = false;

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
      if (!possibleHit) {
        for (const keyword of definition.possibleIngredients) {
          if (ingredientContainsKeyword(lower, keyword)) {
            possibleHit = true;
            break;
          }
        }
      }
      if (directHit && derivedHit) break;
    }

    if (directHit || derivedHit) {
      // Direct wins: a direct-tier hit means viaDerived is false.
      result.push({ id: definition.id, viaDerived: !directHit });
    } else if (possibleHit) {
      // Possible only: stored as a hidden-tier hit plus the `possible` mark.
      result.push({ id: definition.id, viaDerived: true, possible: true });
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
    if (recipeAllergyClash(recipeAllergens, allergy)?.blocking) {
      return false;
    }
  }

  return true;
}

/** One allergen of a recipe that clashes with a person's allergies. */
export interface RecipeAllergyClash {
  allergenId: AllergenId;
  /**
   * What the recipe evidence is: "possible" for a possible-tier entry,
   * otherwise "contains". Drives wording only.
   */
  level: "contains" | "possible";
  /**
   * True when this clash makes the recipe unsafe for that person's severity —
   * exactly the line `isRecipeSafeForAllergies` draws.
   */
  blocking: boolean;
}

/**
 * The single per-allergy tier decision, shared by `isRecipeSafeForAllergies`
 * and `getRecipeAllergyClashes` so the two can never disagree.
 *
 * - direct entry: `contains`, blocking at every severity
 * - derived entry: `contains`, blocking at moderate/severe; no clash at mild
 * - possible entry: always `possible` (never "contains" — owner ruling
 *   2026-11-15), blocking at moderate/severe, not at mild
 * - no entry, or an allergy name that is not a known allergen: `null`
 */
function recipeAllergyClash(
  recipeAllergens: readonly DerivedRecipeAllergen[],
  allergy: { name: string; severity: AllergySeverity },
): RecipeAllergyClash | null {
  const allergenId = normalizeAllergenId(allergy.name);
  if (!allergenId) return null;

  const entry = recipeAllergens.find((a) => a.id === allergenId);
  if (!entry) return null;

  const includeDerived =
    allergy.severity === "moderate" || allergy.severity === "severe";
  // Direct-tier hits are always unsafe. Derived-tier hits (and possible ones,
  // stored as derived) are unsafe only for moderate/severe severity.
  const blocking = !entry.viaDerived || includeDerived;

  if (entry.possible) return { allergenId, level: "possible", blocking };
  return blocking ? { allergenId, level: "contains", blocking } : null;
}

/**
 * Which of a recipe's allergens clash with a person's allergies, and how
 * strongly, for wording like "Contains tree nuts" / "May contain tree nuts".
 *
 * Shares `recipeAllergyClash` with `isRecipeSafeForAllergies`, so a `blocking`
 * clash exists exactly when that function returns `false` because of the
 * allergen. `level` is the wording only. One clash per allergen: `contains`
 * wins over `possible`, and `blocking` is true if either listing blocks.
 *
 * - no allergies → `[]` (nothing to clash with, even for a `null` cache)
 * - `null` cache with at least one allergy → `"unknown"` (not yet derived)
 */
export function getRecipeAllergyClashes(
  recipeAllergens: readonly DerivedRecipeAllergen[] | null,
  allergies: readonly { name: string; severity: AllergySeverity }[],
): RecipeAllergyClash[] | "unknown" {
  if (allergies.length === 0) return [];
  if (recipeAllergens === null) return "unknown";

  const byAllergen = new Map<AllergenId, RecipeAllergyClash>();
  for (const allergy of allergies) {
    const clash = recipeAllergyClash(recipeAllergens, allergy);
    if (!clash) continue;
    const existing = byAllergen.get(clash.allergenId);
    byAllergen.set(
      clash.allergenId,
      existing
        ? {
            allergenId: clash.allergenId,
            level:
              existing.level === "contains" || clash.level === "contains"
                ? "contains"
                : "possible",
            blocking: existing.blocking || clash.blocking,
          }
        : clash,
    );
  }
  return [...byAllergen.values()];
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
 * Gluten-free flour bases (oat, rice, corn, buckwheat, …) suppress the bare
 * *flour* keyword: "rice flour" does not assert wheat in the ingredient string.
 * Oats are the exception in effect, not in this list: "oat flour"/"oat milk"
 * still lose the bare flour/milk match, but "oat" is itself a derived wheat
 * keyword (cross-contact risk, owner ruling 2026-10-16), so wheat flags through
 * it. Gluten-containing grains (wheat/spelt/rye/barley) are intentionally NOT
 * in this list, so "spelt flour"/"rye flour" still flag.
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
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // <plant qualifier><space|hyphen><keyword> at word boundaries, e.g.
    // "almond milk", "unsweetened oat-milk", "coconut flour".
    //
    // The inner join accepts ONLY space and hyphen — the separators that
    // unambiguously bind one compound substitute name. It deliberately excludes
    // every other boundary character, because suppression is the DANGEROUS
    // direction (it removes an allergen flag), so an ambiguous separator must
    // over-flag rather than risk suppressing real dairy/wheat:
    //   - "," and ";" separate distinct list items ("almond, milk" = almond AND
    //     genuine milk), so the milk must still flag.
    //   - "/" is ambiguous: "almond/milk" reads as one substitute, but "/" is
    //     also a list / "and-or" delimiter ("soy/milk", "water/sugar/salt"), so
    //     treating it as a joiner could suppress real milk. Left out on purpose
    //     — safety beats fixing the "almond/milk" over-flag.
    //   - parentheses are ambiguous too; over-flagging is the safe default.
    //
    // Global, and the trailing boundary is a lookahead, so `replace` strips
    // every substitute phrase in the line ("almond milk or oat milk") without
    // consuming the separator the next phrase needs as its leading boundary.
    pattern = new RegExp(
      `(^|[\\s,;/()\\-])(?:${mods})[\\s\\-]${escaped}(?=$|[\\s,;/()\\-])`,
      "gi",
    );
    substituteModifierPatternCache.set(keyword, pattern);
  }
  return pattern;
}

/**
 * True when the keyword still appears once every plant-substitute phrase is
 * removed, i.e. at least one mention is the real dairy/wheat item. A line that
 * holds a substitute AND the real thing ("1 cup milk or almond milk", "flour or
 * rice flour") must still flag: suppressing the whole line because one
 * substitute appears is the dangerous direction (reliability audit
 * 2026-11-19, H-xc-1).
 */
function hasNonSubstituteMention(
  lowerIngredient: string,
  keyword: string,
): boolean {
  const withoutSubstitutes = lowerIngredient.replace(
    getSubstituteModifierPattern(keyword),
    "$1 ",
  );
  return getKeywordPattern(keyword).test(withoutSubstitutes);
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
export function ingredientContainsKeyword(
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

  if (MODIFIER_SENSITIVE_KEYWORDS.has(keyword)) {
    return hasNonSubstituteMention(lowerIngredient, keyword);
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
