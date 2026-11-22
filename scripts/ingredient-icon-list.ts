/**
 * Master ingredient icon list — merged & deduplicated from:
 * - client/data/food-facts.json (36 ingredients)
 * - shared/lib/grocery-categories.ts CATEGORY_KEYWORDS (~160 keywords)
 * - server/services/cultural-food-map.ts CULTURAL_FOOD_MAP (~64 entries)
 *
 * Each entry has a human-readable name, a filename slug, and a category.
 * The generation script uses this list to produce icons in assets/images/ingredients/.
 */

export interface IngredientIconEntry {
  /** Human-readable name used in the FLUX prompt */
  name: string;
  /** Filename slug (kebab-case, no extension) */
  slug: string;
  /** Food category for fallback grouping */
  category: string;
  /** Whether this is a category-level icon (not a specific ingredient) */
  isCategory?: boolean;
}

function entry(
  name: string,
  category: string,
  slugOverride?: string,
): IngredientIconEntry {
  const slug =
    slugOverride ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  return { name, slug, category };
}

// ─── Category fallback icons ────────────────────────────────────────────────

export const CATEGORY_ICONS: IngredientIconEntry[] = [
  // Core food categories (shared/constants/preparation.ts)
  {
    name: "protein food group",
    slug: "category-protein",
    category: "protein",
    isCategory: true,
  },
  {
    name: "vegetable food group",
    slug: "category-vegetable",
    category: "vegetable",
    isCategory: true,
  },
  {
    name: "grain food group",
    slug: "category-grain",
    category: "grain",
    isCategory: true,
  },
  {
    name: "fruit food group",
    slug: "category-fruit",
    category: "fruit",
    isCategory: true,
  },
  {
    name: "dairy food group",
    slug: "category-dairy",
    category: "dairy",
    isCategory: true,
  },
  {
    name: "beverage food group",
    slug: "category-beverage",
    category: "beverage",
    isCategory: true,
  },
  {
    name: "miscellaneous food",
    slug: "category-other",
    category: "other",
    isCategory: true,
  },
  // Grocery-specific categories
  {
    name: "produce food group",
    slug: "category-produce",
    category: "produce",
    isCategory: true,
  },
  {
    name: "meat food group",
    slug: "category-meat",
    category: "meat",
    isCategory: true,
  },
  {
    name: "seafood food group",
    slug: "category-seafood",
    category: "seafood",
    isCategory: true,
  },
  {
    name: "bakery food group",
    slug: "category-bakery",
    category: "bakery",
    isCategory: true,
  },
  {
    name: "canned food group",
    slug: "category-canned",
    category: "canned",
    isCategory: true,
  },
  {
    name: "condiments food group",
    slug: "category-condiments",
    category: "condiments",
    isCategory: true,
  },
  {
    name: "spices food group",
    slug: "category-spices",
    category: "spices",
    isCategory: true,
  },
  {
    name: "frozen food group",
    slug: "category-frozen",
    category: "frozen",
    isCategory: true,
  },
  {
    name: "snacks food group",
    slug: "category-snacks",
    category: "snacks",
    isCategory: true,
  },
];

// ─── Individual ingredient icons ────────────────────────────────────────────

export const INGREDIENT_ICONS: IngredientIconEntry[] = [
  // ── Produce (fruits & vegetables) ──
  entry("apple", "produce"),
  entry("banana", "produce"),
  entry("blueberry", "produce"),
  entry("grape", "produce"),
  entry("lemon", "produce"),
  entry("lime", "produce"),
  entry("mango", "produce"),
  entry("melon", "produce"),
  entry("orange", "produce"),
  entry("coconut", "produce"),
  entry("avocado", "produce"),
  entry("carrot", "produce"),
  entry("celery", "produce"),
  entry("corn", "produce"),
  entry("cucumber", "produce"),
  entry("garlic", "produce"),
  entry("ginger", "produce"),
  entry("lettuce", "produce"),
  entry("mushroom", "produce"),
  entry("onion", "produce"),
  entry("pea", "produce"),
  entry("bell pepper", "produce"),
  entry("potato", "produce"),
  entry("spinach", "produce"),
  entry("tomato", "produce"),
  entry("broccoli", "produce"),
  entry("zucchini", "produce"),
  entry("kale", "produce"),
  entry("arugula", "produce"),
  entry("basil", "produce"),
  entry("cilantro", "produce"),
  entry("parsley", "produce"),
  entry("mint", "produce"),
  entry("thyme", "produce"),
  entry("rosemary", "produce"),
  entry("scallion", "produce"),
  entry("shallot", "produce"),
  entry("squash", "produce"),
  entry("cabbage", "produce"),
  entry("cauliflower", "produce"),
  entry("asparagus", "produce"),
  entry("eggplant", "produce"),
  entry("beet", "produce"),
  entry("radish", "produce"),
  entry("turnip", "produce"),
  entry("sweet potato", "produce"),
  entry("green bean", "produce"),
  entry("snap pea", "produce"),

  // ── Meat ──
  entry("chicken", "meat"),
  entry("beef", "meat"),
  entry("pork", "meat"),
  entry("lamb", "meat"),
  entry("turkey", "meat"),
  entry("bacon", "meat"),
  entry("sausage", "meat"),
  entry("ham", "meat"),
  entry("steak", "meat"),
  entry("veal", "meat"),
  entry("bison", "meat"),
  entry("duck", "meat"),

  // ── Seafood ──
  entry("salmon", "seafood"),
  entry("tuna", "seafood"),
  entry("shrimp", "seafood"),
  entry("cod", "seafood"),
  entry("tilapia", "seafood"),
  entry("crab", "seafood"),
  entry("lobster", "seafood"),
  entry("scallop", "seafood"),
  entry("mussel", "seafood"),
  entry("clam", "seafood"),
  entry("anchovy", "seafood"),
  entry("sardine", "seafood"),
  entry("halibut", "seafood"),
  entry("trout", "seafood"),

  // ── Dairy ──
  entry("milk", "dairy"),
  entry("cheese", "dairy"),
  entry("butter", "dairy"),
  entry("cream", "dairy"),
  entry("yogurt", "dairy"),
  entry("egg", "dairy"),
  entry("sour cream", "dairy"),
  entry("cottage cheese", "dairy"),
  entry("ricotta", "dairy"),
  entry("mozzarella", "dairy"),
  entry("parmesan", "dairy"),
  entry("cheddar", "dairy"),

  // ── Bakery ──
  entry("bread", "bakery"),
  entry("bun", "bakery"),
  entry("tortilla", "bakery"),
  entry("pita", "bakery"),
  entry("naan", "bakery"),
  entry("bagel", "bakery"),

  // ── Grains & legumes ──
  entry("rice", "grains"),
  entry("pasta", "grains"),
  entry("noodle", "grains"),
  entry("oat", "grains"),
  entry("quinoa", "grains"),
  entry("couscous", "grains"),
  entry("barley", "grains"),
  entry("flour", "grains"),
  entry("cereal", "grains"),
  entry("lentil", "grains"),
  entry("bean", "grains"),
  entry("chickpea", "grains"),

  // ── Canned / pantry staples ──
  entry("tomato sauce", "canned"),
  entry("tomato paste", "canned"),
  entry("broth", "canned"),
  entry("coconut milk", "canned"),

  // ── Condiments ──
  entry("ketchup", "condiments"),
  entry("mustard", "condiments"),
  entry("mayonnaise", "condiments"),
  entry("soy sauce", "condiments"),
  entry("vinegar", "condiments"),
  entry("hot sauce", "condiments"),
  entry("sriracha", "condiments"),
  entry("salsa", "condiments"),
  entry("honey", "condiments"),
  entry("maple syrup", "condiments"),
  entry("jam", "condiments"),
  entry("olive oil", "condiments"),
  entry("miso", "condiments"),

  // ── Spices ──
  entry("salt", "spices"),
  entry("pepper", "spices"),
  entry("cumin", "spices"),
  entry("paprika", "spices"),
  entry("cinnamon", "spices"),
  entry("oregano", "spices"),
  entry("chili powder", "spices"),
  entry("turmeric", "spices"),
  entry("nutmeg", "spices"),
  entry("coriander", "spices"),
  entry("cayenne", "spices"),
  entry("bay leaf", "spices"),
  entry("clove", "spices"),
  entry("allspice", "spices"),

  // ── Frozen ──
  entry("ice cream", "frozen"),

  // ── Beverages ──
  entry("juice", "beverages"),
  entry("coffee", "beverages"),
  entry("tea", "beverages"),
  entry("kombucha", "beverages"),

  // ── Snacks & nuts ──
  entry("almond", "snacks"),
  entry("walnut", "snacks"),
  entry("pecan", "snacks"),
  entry("cashew", "snacks"),
  entry("peanut", "snacks"),
  entry("granola", "snacks"),
  entry("popcorn", "snacks"),
  entry("dark chocolate", "snacks"),

  // ── Cultural foods (from cultural-food-map.ts standardNames) ──
  entry("lentil curry", "protein", "lentil-curry"),
  entry("flatbread", "grains"),
  entry("rice pilaf", "grains", "rice-pilaf"),
  entry("tandoori chicken", "meat", "tandoori-chicken"),
  entry("paneer", "dairy"),
  entry("sushi", "seafood"),
  entry("ramen", "grains"),
  entry("dumpling", "grains"),
  entry("fried rice", "grains", "fried-rice"),
  entry("spring roll", "grains", "spring-roll"),
  entry("kimchi", "vegetable"),
  entry("tofu", "protein"),
  entry("pad thai", "grains", "pad-thai"),
  entry("pho", "grains"),
  entry("satay", "protein"),
  entry("hummus", "protein"),
  entry("falafel", "protein"),
  entry("shawarma", "protein"),
  entry("taco", "grains"),
  entry("burrito", "grains"),
  entry("guacamole", "produce"),
  entry("tamale", "grains"),
  entry("empanada", "grains"),
  entry("ceviche", "seafood"),
  entry("plantain", "produce"),
  entry("couscous dish", "grains", "couscous-dish"),
  entry("risotto", "grains"),
  entry("paella", "grains"),
  entry("lasagna", "grains"),
  entry("pierogi", "grains"),
  entry("borscht", "vegetable"),
];

// ─── Full list (categories + ingredients) ───────────────────────────────────

export const ALL_ICONS: IngredientIconEntry[] = [
  ...CATEGORY_ICONS,
  ...INGREDIENT_ICONS,
];
