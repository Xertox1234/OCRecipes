import type { RecipeIngredient } from "@shared/schema";
import {
  detectAllergens,
  type AllergenMatch,
  type AllergySeverity,
} from "@shared/constants/allergens";
import { normalizeQuantityToDecimal } from "@shared/lib/quantity";

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

export interface AggregatedGroceryItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
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
};

/**
 * Normalize an ingredient name for grouping.
 */
export function normalizeIngredientName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

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

/** Round to 2 decimals so float sums (0.1 + 0.2) don't persist as 0.30000000000000004. */
export function roundQuantity(n: number): number {
  return Math.round(n * 100) / 100;
}

const RANGE_RE = /^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i;

function parseSingleQuantity(raw: string): number | null {
  const normalized = normalizeQuantityToDecimal(raw);
  if (normalized !== null) return Number(normalized);
  return null;
}

/**
 * Parse an ingredient quantity string to a number for summing. Handles
 * integers, decimals, fractions ("1/2"), mixed numbers ("1 1/2") and unicode
 * glyphs via normalizeQuantityToDecimal; a range ("1-2", "2 to 3") takes its
 * upper end so the grocery list never under-buys. Free-form text keeps its
 * leading number ("2 large" → 2). Returns null when nothing numeric is found.
 * (Bare parseFloat read "1/2" as 1 and "1-2" as 1.)
 */
export function parseQuantityForSum(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const single = parseSingleQuantity(trimmed);
  if (single !== null) return single;

  const range = trimmed.match(RANGE_RE);
  if (range) {
    const lo = parseSingleQuantity(range[1]);
    const hi = parseSingleQuantity(range[2]);
    if (lo !== null && hi !== null) return Math.max(lo, hi);
  }

  const leading = parseFloat(trimmed);
  return Number.isFinite(leading) ? leading : null;
}

/**
 * Aggregate recipe ingredients into a grocery list, merging duplicates.
 * Pure function, no DB access.
 */
export function generateGroceryItems(
  ingredients: RecipeIngredient[],
): AggregatedGroceryItem[] {
  const grouped = new Map<
    string,
    { quantity: number | null; unit: string | null; category: string }
  >();

  for (const ing of ingredients) {
    const normalized = normalizeIngredientName(ing.name);
    const unit = ing.unit?.toLowerCase().trim() || null;
    // Group key includes unit so "2 cups flour" and "100g flour" stay separate
    const key = `${normalized}|${unit || ""}`;

    const existing = grouped.get(key);
    const qty = parseQuantityForSum(ing.quantity);

    if (existing) {
      if (existing.quantity !== null && qty !== null) {
        existing.quantity = roundQuantity(existing.quantity + qty);
      } else if (qty !== null) {
        existing.quantity = qty;
      }
    } else {
      grouped.set(key, {
        quantity: qty,
        unit,
        category:
          ing.category && ing.category !== "other"
            ? ing.category
            : categorizeIngredient(normalized),
      });
    }
  }

  const items: AggregatedGroceryItem[] = [];
  for (const [key, value] of grouped) {
    const name = key.split("|")[0];
    items.push({
      name,
      quantity: value.quantity,
      unit: value.unit,
      category: value.category,
    });
  }

  // Sort by category then name
  items.sort((a, b) =>
    a.category === b.category
      ? a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  return items;
}

/**
 * Annotates grocery items with allergen matches against the user's profile.
 * Pure function — runs `detectAllergens` over item names.
 */
export function flagAllergenicGroceryItems(
  items: AggregatedGroceryItem[],
  userAllergies: { name: string; severity: AllergySeverity }[],
): Map<string, AllergenMatch> {
  if (userAllergies.length === 0) return new Map();

  const names = items.map((i) => i.name);
  const matches = detectAllergens(names, userAllergies);

  // One match per item name (first match wins)
  const flagMap = new Map<string, AllergenMatch>();
  for (const m of matches) {
    if (!flagMap.has(m.ingredientName)) {
      flagMap.set(m.ingredientName, m);
    }
  }
  return flagMap;
}
