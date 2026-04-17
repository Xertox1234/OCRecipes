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
