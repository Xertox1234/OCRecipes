/**
 * Grocery store aisles and the keyword guess that files an item under one.
 * Shared so the add box's hint (client) and every server insert path use one
 * list. Moved from `server/services/grocery-generation.ts`.
 */
export const GROCERY_CATEGORIES = [
  "produce",
  "meat",
  "seafood",
  "dairy",
  "bakery",
  "grains",
  "canned",
  "condiments",
  "spices",
  "frozen",
  "beverages",
  "snacks",
  "other",
] as const;

export type GroceryCategory = (typeof GROCERY_CATEGORIES)[number];

export function isGroceryCategory(value: unknown): value is GroceryCategory {
  return (GROCERY_CATEGORIES as readonly unknown[]).includes(value);
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  produce: [
    "apple",
    "banana",
    "berry",
    "berries",
    "carrot",
    "celery",
    "corn",
    "cucumber",
    "garlic",
    "ginger",
    "grape",
    "lemon",
    "lettuce",
    "lime",
    "mango",
    "melon",
    "mushroom",
    "onion",
    "orange",
    "pea",
    "pepper",
    "potato",
    "spinach",
    "tomato",
    "avocado",
    "broccoli",
    "zucchini",
    "kale",
    "arugula",
    "basil",
    "cilantro",
    "parsley",
    "mint",
    "thyme",
    "rosemary",
    "scallion",
    "shallot",
    "squash",
    "cabbage",
    "cauliflower",
    "asparagus",
    "eggplant",
    "beet",
    "radish",
    "turnip",
    "sweet potato",
    "green bean",
    "snap pea",
  ],
  meat: [
    "chicken",
    "beef",
    "pork",
    "lamb",
    "turkey",
    "bacon",
    "sausage",
    "ham",
    "steak",
    "ground beef",
    "ground pork",
    "ground turkey",
    "ground chicken",
    "ground lamb",
    "veal",
    "bison",
    "duck",
    "mince",
  ],
  seafood: [
    "salmon",
    "tuna",
    "shrimp",
    "cod",
    "tilapia",
    "crab",
    "lobster",
    "fish",
    "scallop",
    "mussel",
    "clam",
    "anchovy",
    "sardine",
    "halibut",
    "trout",
  ],
  dairy: [
    "milk",
    "cheese",
    "butter",
    "cream",
    "yogurt",
    "egg",
    "sour cream",
    "cottage cheese",
    "ricotta",
    "mozzarella",
    "parmesan",
    "cheddar",
    "whipping cream",
    "half and half",
  ],
  bakery: ["bread", "bun", "roll", "tortilla", "pita", "naan", "bagel"],
  grains: [
    "rice",
    "pasta",
    "noodle",
    "oat",
    "quinoa",
    "couscous",
    "barley",
    "flour",
    "cereal",
    "lentil",
    "bean",
    "chickpea",
  ],
  canned: [
    "canned",
    "tomato sauce",
    "tomato paste",
    "broth",
    "stock",
    "coconut milk",
  ],
  condiments: [
    "ketchup",
    "mustard",
    "mayo",
    "mayonnaise",
    "soy sauce",
    "vinegar",
    "hot sauce",
    "worcestershire",
    "sriracha",
    "salsa",
    "bbq sauce",
    "dressing",
    "honey",
    "maple syrup",
    "jam",
  ],
  spices: [
    "salt",
    "pepper",
    "cumin",
    "paprika",
    "cinnamon",
    "oregano",
    "chili powder",
    "turmeric",
    "nutmeg",
    "coriander",
    "cayenne",
    "bay leaf",
    "clove",
    "allspice",
  ],
  frozen: ["frozen", "ice cream"],
  beverages: [
    "juice",
    "coffee",
    "tea",
    "water",
    "soda",
    "wine",
    "beer",
    "kombucha",
    "champagne",
  ],
  snacks: [
    "chip",
    "cracker",
    "nut",
    "almond",
    "walnut",
    "pecan",
    "cashew",
    "peanut",
    "granola",
    "popcorn",
    "pretzel",
    "trail mix",
    "dried fruit",
  ],
  // Household items. Matching is by substring and the longest keyword wins, so
  // these stop "shampoo" filing under meat ("ham") and "kitchen roll" under
  // bakery ("roll").
  other: [
    "shampoo",
    "conditioner",
    "deodorant",
    "toothpaste",
    "toilet",
    "kitchen roll",
    "paper towel",
    "tissue",
    "napkin",
    "soap",
    "detergent",
    "sponge",
    "foil",
    "cling film",
    "bin bag",
    "trash bag",
  ],
};

/**
 * Guess a grocery store category for an ingredient name.
 */
export function categorizeIngredient(name: string): GroceryCategory {
  const lower = name.toLowerCase();

  // Check categories with longer keywords first to avoid false matches
  // e.g. "ground cumin" should match "cumin" in spices, not "ground" in meat
  let bestMatch: { category: string; length: number } | null = null;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) && (!bestMatch || kw.length > bestMatch.length)) {
        bestMatch = { category, length: kw.length };
      }
    }
  }

  return (bestMatch?.category as GroceryCategory) ?? "other";
}
