import type { DietTag } from "@/components/recipe-wizard/types";

const CUISINE_KEYWORDS: Record<string, string[]> = {
  Italian: [
    "parmesan",
    "marinara",
    "mozzarella",
    "pasta",
    "risotto",
    "pesto",
    "prosciutto",
    "bruschetta",
    "gnocchi",
    "lasagna",
    "ravioli",
    "focaccia",
    "tiramisu",
  ],
  Mexican: [
    "tortilla",
    "salsa",
    "cilantro",
    "jalapeño",
    "jalapeno",
    "cumin",
    "enchilada",
    "taco",
    "burrito",
    "quesadilla",
    "guacamole",
    "chipotle",
  ],
  Chinese: [
    "soy sauce",
    "ginger",
    "sesame",
    "wok",
    "stir fry",
    "tofu",
    "bok choy",
    "hoisin",
    "dim sum",
    "chow mein",
    "dumpling",
  ],
  Japanese: [
    "miso",
    "sushi",
    "wasabi",
    "teriyaki",
    "dashi",
    "nori",
    "edamame",
    "ramen",
    "tempura",
    "udon",
    "sake",
  ],
  Indian: [
    "curry",
    "turmeric",
    "garam masala",
    "naan",
    "tikka",
    "masala",
    "cardamom",
    "tandoori",
    "paneer",
    "biryani",
    "dal",
    "chutney",
  ],
  Thai: [
    "coconut milk",
    "lemongrass",
    "thai basil",
    "fish sauce",
    "galangal",
    "pad thai",
    "green curry",
    "red curry",
    "tom yum",
  ],
  French: [
    "beurre",
    "croissant",
    "roux",
    "gratin",
    "soufflé",
    "souffle",
    "crème",
    "creme",
    "béchamel",
    "bechamel",
    "brioche",
  ],
  Greek: [
    "feta",
    "tzatziki",
    "gyro",
    "oregano",
    "pita",
    "souvlaki",
    "moussaka",
    "spanakopita",
  ],
  Korean: [
    "kimchi",
    "gochujang",
    "bulgogi",
    "sesame oil",
    "bibimbap",
    "japchae",
    "doenjang",
  ],
  American: [
    "burger",
    "bbq",
    "barbecue",
    "ranch",
    "mac and cheese",
    "cornbread",
    "brisket",
  ],
};

const MEAT_KEYWORDS = [
  "chicken",
  "beef",
  "pork",
  "lamb",
  "turkey",
  "bacon",
  "sausage",
  "steak",
  "ham",
  "veal",
  "duck",
  "venison",
  "prosciutto",
  "pepperoni",
  "salami",
  "ground beef",
  "ground turkey",
  "ground pork",
  "shrimp",
  "salmon",
  "tuna",
  "fish",
  "crab",
  "lobster",
  "anchovy",
  "anchovies",
  "sardine",
];

const DAIRY_KEYWORDS = [
  "milk",
  "cheese",
  "butter",
  "cream",
  "yogurt",
  "mozzarella",
  "parmesan",
  "cheddar",
  "ricotta",
  "mascarpone",
  "ghee",
  "sour cream",
  "whey",
  "heavy cream",
  "half and half",
  "brie",
  "gouda",
  "feta",
  "paneer",
];

const GLUTEN_KEYWORDS = [
  "flour",
  "bread",
  "pasta",
  "noodle",
  "breadcrumb",
  "wheat",
  "tortilla",
  "crouton",
  "couscous",
  "barley",
  "rye",
  "soy sauce",
  "beer",
  "pie crust",
  "pizza dough",
  "pita",
  "naan",
  "croissant",
  "brioche",
];

const EGG_KEYWORDS = ["egg", "eggs", "egg white", "egg yolk", "mayonnaise"];

export function inferCuisine(
  title: string,
  ingredientNames: string[],
): string | null {
  const searchText = [title, ...ingredientNames].join(" ").toLowerCase();

  let bestCuisine: string | null = null;
  let bestScore = 0;

  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCuisine = cuisine;
    }
  }

  return bestScore >= 1 ? bestCuisine : null;
}

/**
 * Infer diet tags from an ingredient list.
 *
 * Coverage of `DIET_TAG_OPTIONS` (see `components/recipe-wizard/types.ts`):
 *
 *   Covered by ingredient heuristics (exclusion of keyword lists):
 *     - Vegetarian   — no meat/seafood keywords
 *     - Vegan        — no meat/seafood, dairy, or egg keywords
 *     - Gluten Free  — no gluten keywords
 *     - Dairy Free   — no dairy keywords
 *
 *   Intentionally NOT inferred here:
 *     - Keto, Paleo, Low Carb, High Protein
 *
 * These four depend on per-serving macronutrient ratios (net carbs, protein
 * %, ingredient whitelists) that are not reliably derivable from an ingredient
 * name list alone. We prefer to surface no suggestion over a wrong one — the
 * user can still toggle these in the TagsStep manually. If we later accept
 * a nutrition snapshot alongside the ingredient list, inference for these
 * tags can be added as a second pass.
 */
export function inferDietTags(ingredientNames: string[]): DietTag[] {
  if (ingredientNames.length === 0) return [];

  const lowerIngredients = ingredientNames.map((n) => n.toLowerCase());
  const allText = lowerIngredients.join(" ");

  const hasMeat = MEAT_KEYWORDS.some((kw) => allText.includes(kw));
  const hasDairy = DAIRY_KEYWORDS.some((kw) => allText.includes(kw));
  const hasGluten = GLUTEN_KEYWORDS.some((kw) => allText.includes(kw));
  const hasEggs = EGG_KEYWORDS.some((kw) => allText.includes(kw));

  const tags: DietTag[] = [];

  if (!hasMeat) tags.push("Vegetarian");
  if (!hasMeat && !hasDairy && !hasEggs) tags.push("Vegan");
  if (!hasGluten) tags.push("Gluten Free");
  if (!hasDairy) tags.push("Dairy Free");

  return tags;
}
